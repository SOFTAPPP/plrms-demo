import os, re

for root, dirs, files in os.walk('src'):
    for file in files:
        if file.endswith('.tsx'):
            p = os.path.join(root, file)
            with open(p, 'r', encoding='utf-8') as f:
                c = f.read()
            for m in re.finditer(r'<[Bb]utton[^>]*disabled=\{([^}]+)\}', c):
                line = c[:m.start()].count('\n') + 1
                cond = m.group(1).strip()
                print(f'{p}:{line} disabled={cond}')
