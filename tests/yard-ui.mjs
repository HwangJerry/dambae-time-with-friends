import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const origin = process.env.TEST_ORIGIN ?? 'http://localhost:3101';
const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--enable-unsafe-swiftshader',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ['microphone'],
});
await context.addInitScript(() => {
  window.testGains = [];
  window.testPeers = [];
  const BaseAudio = window.AudioContext;
  window.AudioContext = class extends BaseAudio {
    createGain() {
      const gain = super.createGain();
      window.testGains.push(gain);
      return gain;
    }
  };
  const BasePeer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends BasePeer {
    constructor(options) {
      super(options);
      window.testPeers.push(this);
    }
  };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let owner, friend;
async function snapshot(session) {
  return (
    await context.request.get(`${origin}/api/rooms/${session.roomId}/sync`, {
      headers: {
        Authorization: `Bearer ${session.token}`,
        'X-Room-Connection': session.connectionId,
      },
    })
  ).json();
}
async function action(session, body) {
  const response = await context.request.post(
    `${origin}/api/rooms/${session.roomId}/action`,
    {
      headers: { Authorization: `Bearer ${session.token}` },
      data: { ...body, connectionId: session.connectionId },
    },
  );
  assert.equal(response.status(), 200);
}
try {
  await mkdir('outputs', { recursive: true });
  await page.goto(origin);
  await page.getByLabel('어떻게 부르면 될까요?').fill('테스트 나');
  const creation = page.waitForResponse(
    (r) => r.url().endsWith('/api/rooms') && r.status() === 201,
  );
  await page
    .getByRole('button', { name: '친구방 만들기', exact: true })
    .click();
  owner = await (await creation).json();
  await page.locator('.avatar-label').waitFor();
  await page.waitForFunction(
    () => document.querySelector('.avatar-label')?.dataset.burning === 'false',
  );
  assert.equal(
    await page.locator('.avatar-label').getAttribute('data-ash-visible'),
    'false',
  );
  await page.locator('.yard-canvas canvas').focus();
  const before = (await snapshot(owner)).participants[0];
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(650);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(800);
  const after = (await snapshot(owner)).participants[0];
  assert(
    Math.hypot(after.x - before.x, after.z - before.z) > 0.4,
    'arrow keys must move the character',
  );
  assert.equal(
    await page.locator('.avatar-label').getAttribute('data-hand-lift'),
    '0.00',
  );
  await page.getByLabel('연기에 띄울 말').fill('방향키는 채팅 중 멈춰요');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowLeft');
  const typingPosition = (await snapshot(owner)).participants[0];
  assert(
    Math.hypot(after.x - typingPosition.x, after.z - typingPosition.z) < 0.05,
  );
  const labelBefore = await page
    .locator('.avatar-label')
    .evaluate((el) => el.style.left);
  const canvasBox = await page.locator('.yard-canvas canvas').boundingBox();
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.5,
    canvasBox.y + canvasBox.height * 0.6,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.5 + 180,
    canvasBox.y + canvasBox.height * 0.6,
    { steps: 12 },
  );
  await page.mouse.up();
  await page.waitForTimeout(500);
  assert.notEqual(
    await page.locator('.avatar-label').evaluate((el) => el.style.left),
    labelBefore,
    'drag changes the camera',
  );
  const second = await context.newPage();
  await second.goto(page.url());
  await second.getByLabel('어떻게 부르면 될까요?').fill('테스트 친구');
  await second.getByRole('radio', { name: '여자', exact: true }).check();
  const joining = second.waitForResponse(
    (r) => r.url().includes('/join') && r.status() === 201,
  );
  await second
    .getByRole('button', { name: '친구방 들어가기', exact: true })
    .click();
  friend = await (await joining).json();
  assert.equal(
    (await snapshot(friend)).participants.find(
      (p) => p.id === friend.participantId,
    ).avatar,
    'female',
  );
  await second.locator('.yard-canvas canvas').waitFor();
  await second
    .getByRole('button', { name: '마이크 켜기', exact: true })
    .click();
  await page.waitForTimeout(1500);
  const unlock = page.getByRole('button', {
    name: '친구 목소리 듣기',
    exact: true,
  });
  if (await unlock.isVisible()) await unlock.click();
  await page.waitForFunction(
    () => window.testPeers.some((p) => p.connectionState === 'connected'),
    { timeout: 20000 },
  );
  await page.waitForFunction(async () => {
    for (const peer of window.testPeers) {
      const stats = await peer.getStats();
      for (const item of stats.values())
        if (
          item.type === 'inbound-rtp' &&
          item.kind === 'audio' &&
          item.bytesReceived > 0
        )
          return true;
    }
    return false;
  });
  const ownerPos = (await snapshot(owner)).participants.find(
    (p) => p.id === owner.participantId,
  );
  await action(friend, { type: 'move', x: ownerPos.x + 0.5, z: ownerPos.z });
  await page.waitForFunction(() => window.testGains[0]?.gain.value > 0.98);
  await action(friend, { type: 'move', x: ownerPos.x + 3, z: ownerPos.z });
  await page.waitForFunction(
    () =>
      window.testGains[0]?.gain.value > 0.55 &&
      window.testGains[0]?.gain.value < 0.65,
  );
  await action(friend, { type: 'move', x: 6.7, z: 5.7 });
  await page.waitForFunction(() => window.testGains[0]?.gain.value === 0);
  console.log(
    'PASS: actual WebRTC connection and gain reach full volume nearby / exact zero beyond cutoff',
  );
  await page.getByRole('button', { name: '불붙이기', exact: true }).click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.avatar-label')].some(
        (el) => Number(el.dataset.handLift) > 0.5,
      ),
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.avatar-label')].some(
        (el) => el.dataset.ashVisible === 'true',
      ),
    { timeout: 10000 },
  );
  await page.locator('.room-settings summary').click();
  await page
    .getByRole('button', { name: '타는 소리 꺼짐', exact: true })
    .click();
  assert.equal(
    await page
      .getByRole('button', { name: '타는 소리 켜짐', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page
    .getByRole('button', { name: '타는 소리 켜짐', exact: true })
    .click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.room-settings').getAttribute('open'), null);
  await page.screenshot({ path: 'outputs/yard-desktop.png', fullPage: true });
  await page.route('**/sync?*', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.participants = json.participants.map((p) =>
      p.id === owner.participantId ? { ...p, litAt: Date.now() - 301000 } : p,
    );
    await route.fulfill({ response, json });
  });
  await page.getByRole('button', { name: '한 대 더', exact: true }).waitFor();
  await page.waitForTimeout(1000);
  const selfLabel = page
    .locator('.avatar-label')
    .filter({ hasText: '테스트 나' });
  assert.equal(await selfLabel.getAttribute('data-hand-lift'), '0.00');
  assert.equal(await selfLabel.getAttribute('data-ash-visible'), 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    ),
    'room must fit one viewport',
  );
  await page.locator('.room-settings summary').click();
  assert(await page.getByRole('button', { name: '흡연장 나가기' }).isVisible());
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'outputs/yard-mobile.png', fullPage: true });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: arrows, typing isolation, orbit camera, lit-only puff/ash, burn sound toggle, finished state, mobile width, no page errors',
  );
} finally {
  await page.unrouteAll({ behavior: 'wait' });
  for (const session of [owner, friend].filter(Boolean))
    await action(session, { type: 'leave' }).catch(() => {});
  await browser.close();
}
