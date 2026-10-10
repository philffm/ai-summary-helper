// Release notes from commit messages: parsing (bot bumps, merges, noise skipped; bullets and wrapped lines kept), grouping, tag lookup, CHANGELOG insertion.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
const mod = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, '..', '..', 'scripts', 'changelog.mjs')).href);
const { parseCommits, classify, renderGroups, insertRelease, previousTag } = mod;
const rec = (author, subject, body = '') => `h\x1f${author}\x1f${subject}\x1f${body}\x1e\n`;
const raw = rec('Phil', 'Onboarding: compact mask', '- Dropped the heading\n- Continue is inactive until\n  something works\n\nCo-Authored-By: x')
  + rec('github-actions[bot]', 'chore: bump version to 2.2.3 [skip ci]')
  + rec('Phil', "Merge branch 'feat/x'")
  + rec('Phil', 'up')
  + rec('Phil', 'Tests: poll instead of fixed ticks')
  + rec('Phil', 'Fix the sign-in redirect')
  + rec('Phil', 'Add a back to top button');
const { commits, skipped } = parseCommits(raw);
assert.deepEqual(commits.map((c) => c.subject), ['Onboarding: compact mask', 'Tests: poll instead of fixed ticks', 'Fix the sign-in redirect', 'Add a back to top button']);
assert.equal(skipped, 1, 'only the non-descriptive subject is counted');
assert.deepEqual(commits[0].bullets, ['Dropped the heading', 'Continue is inactive until something works'], 'bullets kept, wrapped line joined, trailer dropped');
assert.equal(classify('Tests: poll'), 'Developer experience');
assert.equal(classify('Fix the sign-in redirect'), 'Fixed');
assert.equal(classify('Onboarding: add green cards'), 'Added');
assert.equal(classify('Onboarding: compact mask'), 'Changed');
const groups = renderGroups(commits);
assert(groups.indexOf('### Added') < groups.indexOf('### Changed') && groups.indexOf('### Changed') < groups.indexOf('### Fixed') && groups.indexOf('### Fixed') < groups.indexOf('### Developer experience'), 'fixed group order');
assert(/- Onboarding: compact mask\n {2}- Dropped the heading/.test(groups), 'details nest under their commit');

assert.equal(previousTag(['v2.2.1', 'v2.2.3', 'v2.2.10', 'v2.3.0', 'nightly'], '2.2.11'), 'v2.2.10', 'semantic, not alphabetical');
assert.equal(previousTag(['v2.2.3'], '2.2.3'), '', 'the version itself is not its own predecessor');

// CHANGELOG: Unreleased with hand-written text becomes the release and keeps it; the commit log goes below
const md = '# Changelog\n\nIntro.\n\n## Unreleased\n\n### Added\n- By hand.\n\n## 2.2.x (October 2026)\n- Old.\n';
const out = insertRelease(md, '2.2.4', '2026-10-10', groups);
assert(/## Unreleased\n\n## 2\.2\.4 \(2026-10-10\)\n\n### Added\n- By hand\./.test(out), 'fresh empty Unreleased on top, hand-written part kept');
assert(/### Commit log\n\n#### Added\n\n- Add a back to top button/.test(out), 'generated list under Commit log, headings demoted');
assert(out.indexOf('## 2.2.4') < out.indexOf('## 2.2.x'), 'newest first');
assert.equal(insertRelease(out, '2.2.4', '2026-10-10', groups), out, 'running it twice changes nothing');
// no Unreleased section: new section above the newest one
const plain = insertRelease('# Changelog\n\n## 2.2.x\n- Old.\n', '2.2.4', '2026-10-10', groups);
assert(plain.indexOf('## 2.2.4 (2026-10-10)') < plain.indexOf('## 2.2.x') && /### Added\n\n- Add a back to top button/.test(plain));
console.log('TEST 125 OK'); process.exit(0);
