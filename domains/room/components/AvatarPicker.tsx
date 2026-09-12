'use client';
import type { AvatarStyle } from '../types';
export function AvatarPicker({
  value,
  onChange,
}: {
  value: AvatarStyle;
  onChange: (style: AvatarStyle) => void;
}) {
  return (
    <fieldset className="avatar-picker">
      <legend>캐릭터</legend>
      {(['male', 'female'] as const).map((style) => (
        <label key={style} className={value === style ? 'selected' : ''}>
          <input
            type="radio"
            name="avatar"
            value={style}
            checked={value === style}
            onChange={() => onChange(style)}
          />
          <span className={`avatar-mini ${style}`} aria-hidden="true">
            <i />
            <b />
          </span>
          <span>{style === 'male' ? '남자' : '여자'}</span>
        </label>
      ))}
    </fieldset>
  );
}
