import argparse
import json
import os
from pathlib import Path
import sys

from .contract import manifest
from .runner import build, release


def main():
    parser = argparse.ArgumentParser(description='Malfunction portable deployment harness')
    parser.add_argument('operation', choices=['matrix', 'validate', 'build', 'release'])
    parser.add_argument('--root', default='.')
    parser.add_argument('--component')
    parser.add_argument('--sha')
    parser.add_argument('--request-id')
    parser.add_argument('--artifact')
    parser.add_argument('--output')
    args = parser.parse_args()
    root = Path(args.root).resolve()
    try:
        if args.operation in ('matrix', 'validate'):
            config = manifest(json.loads((root / '.malfunction/deploy.json').read_text()))
            result = {'include': [{'id': c['id'], 'kind': c['kind'],
                                   'image': c['build'].get('image', ''),
                                   'node': c['build'].get('node', ''),
                                   'runner': ['self-hosted', 'macOS', 'malfunction-ios'] if c['kind'] == 'ios' else 'ubuntu-latest'}
                                  for c in config['components'] if c['kind'] != 'shared']}
        elif args.operation == 'build':
            result = build(root, args.component, args.sha)
        else:
            result = release(root, args.component, args.sha,
                             json.loads(Path(args.artifact).read_text()), args.request_id,
                             json.loads(os.environ.get('MALFUNCTION_TARGETS_JSON', '{}')))
        if args.output:
            output = Path(args.output)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        else:
            print(json.dumps(result, ensure_ascii=False))
        return 0
    except (ValueError, RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        if args.operation == 'release' and args.output:
            output = Path(args.output)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps({'status': 'failed', 'component': args.component,
                'source_sha': args.sha, 'request_id': args.request_id, 'reason': str(error)[:1000]}, ensure_ascii=False) + '\n')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
