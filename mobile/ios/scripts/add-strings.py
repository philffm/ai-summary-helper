#!/usr/bin/env python3
"""Adds or updates strings in App/Localizable.xcstrings from lines on stdin; every other string stays as it is.
Line format, "|"-separated: English key|ar|de|es|fi|fr|ja|ko|pt-BR|ru|uk|zh-Hans|zh-Hant
New translations are marked "needs_review" until a native speaker has checked them.
    python3 mobile/ios/scripts/add-strings.py < new-strings.txt
"""
import json
import pathlib
import sys

LANGUAGES = ['ar', 'de', 'es', 'fi', 'fr', 'ja', 'ko', 'pt-BR', 'ru', 'uk', 'zh-Hans', 'zh-Hant']
PATH = pathlib.Path(__file__).resolve().parent.parent / 'App' / 'Localizable.xcstrings'

catalog = json.loads(PATH.read_text(encoding='utf-8'))
count = 0
for line in sys.stdin.read().splitlines():
    if not line.strip():
        continue
    key, *values = line.split('|')
    if len(values) != len(LANGUAGES):
        sys.exit(f'{key!r}: {len(values)} translations, expected {len(LANGUAGES)}')
    localizations = {}
    for language, value in zip(LANGUAGES, values):
        if value.count('%@') != key.count('%@'):
            sys.exit(f'{key!r} [{language}]: the placeholders differ')
        if value.count('%@') > 1:   # translations may reorder them
            for position in range(1, value.count('%@') + 1):
                value = value.replace('%@', f'%{position}$@', 1)
        localizations[language] = {'stringUnit': {'state': 'needs_review', 'value': value}}
    catalog['strings'][key] = {'localizations': localizations}
    count += 1
catalog['strings'] = dict(sorted(catalog['strings'].items()))
PATH.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'{count} strings added or updated, {len(catalog["strings"])} in all')
