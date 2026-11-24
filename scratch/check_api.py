import os, re

# Find all api endpoints called from src
api_calls = set()
for root, dirs, files in os.walk('src'):
    for file in files:
        if file.endswith('.tsx') or file.endswith('.ts'):
            with open(os.path.join(root, file), 'r', encoding='utf-8') as f:
                c = f.read()
            for m in re.finditer(r'(get|post|put|patch|del|useQuery)\s*(?:<[^>]+>)?\s*\(\s*[`\'"]([^`\'"?$]+)', c):
                api_calls.add((m.group(1), m.group(2)))

print(f'Total unique API calls in src: {len(api_calls)}')
for method, endpoint in sorted(api_calls):
    print(f'{method.upper():10} {endpoint}')
