import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const VERSION_FILES = ['package.json', 'package-lock.json', 'manifest.json', 'versions.json'];
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args) {
	return execFileSync(command, args, {
		cwd: ROOT,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();
}

function runLive(command, args) {
	execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });
}

function fail(message) {
	throw new Error(message);
}

function readJson(path) {
	return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
}

function getCurrentTag() {
	const tags = run('git', ['tag', '--merged', 'HEAD', '--sort=-version:refname'])
		.split(/\r?\n/)
		.filter((tag) => /^\d+\.\d+\.\d+$/.test(tag));
	if (!tags[0]) fail('현재 커밋에서 확인할 수 있는 릴리스 태그가 없습니다.');
	return tags[0];
}

function verifyMetadata(version) {
	const packageJson = readJson('package.json');
	const packageLock = readJson('package-lock.json');
	const manifest = readJson('manifest.json');
	const versions = readJson('versions.json');
	const values = [
		packageJson.version,
		packageLock.version,
		packageLock.packages?.['']?.version,
		manifest.version,
	];
	if (values.some((value) => value !== version) ||
		!Object.prototype.hasOwnProperty.call(versions, version)) {
		fail(`버전 메타데이터가 ${version}과 일치하지 않습니다.`);
	}
}

function verifyLocalState() {
	const branch = run('git', ['branch', '--show-current']);
	if (branch !== 'main') fail(`main 브랜치에서 실행해야 합니다. 현재 브랜치: ${branch || '(없음)'}`);
	if (run('git', ['status', '--porcelain'])) fail('커밋되지 않은 변경이 있습니다. 먼저 변경 사항을 정리해 주세요.');

	const currentTag = getCurrentTag();
	verifyMetadata(currentTag);
	const commits = run('git', ['log', '--format=%h%x09%s', `${currentTag}..HEAD`]);
	if (!commits) fail(`${currentTag} 이후 릴리스할 커밋이 없습니다.`);
	return { branch, commits: commits.split(/\r?\n/), currentTag, head: run('git', ['rev-parse', 'HEAD']) };
}

function verifyRemoteState(initialHead) {
	runLive('git', ['fetch', '--prune', '--tags', 'origin']);
	if (run('git', ['rev-parse', 'HEAD']) !== initialHead) fail('확인 중 현재 커밋이 변경되었습니다. 다시 실행해 주세요.');
	if (run('git', ['status', '--porcelain'])) fail('확인 중 작업 트리가 변경되었습니다. 다시 실행해 주세요.');

	const [behindText, aheadText] = run('git', ['rev-list', '--left-right', '--count', 'origin/main...HEAD'])
		.split(/\s+/);
	const behind = Number(behindText);
	const ahead = Number(aheadText);
	if (behind > 0 && ahead > 0) fail('main과 origin/main의 기록이 갈라졌습니다. 먼저 동기화해 주세요.');
	if (behind > 0) fail(`main이 origin/main보다 ${behind}개 커밋 뒤에 있습니다. 먼저 동기화해 주세요.`);
}

function nextVersions(version) {
	const [major, minor, patch] = version.split('.').map(Number);
	return {
		'1': `${major + 1}.0.0`,
		'2': `${major}.${minor + 1}.0`,
		'3': `${major}.${minor}.${patch + 1}`,
	};
}

function tagExists(tag) {
	return spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: ROOT }).status === 0;
}

function repositoryUrl(path) {
	const remote = run('git', ['remote', 'get-url', 'origin']);
	const match = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
	return match ? `https://github.com/${match[1]}/${match[2]}/${path}` : null;
}

async function chooseVersion(currentTag, rl) {
	const choices = nextVersions(currentTag);
	console.log('\n다음 버전을 선택하세요.\n');
	console.log(`  1. Major — 첫째 자리: ${choices['1']} (호환성이 깨지는 변경)`);
	console.log(`  2. Minor — 둘째 자리: ${choices['2']} (기존 기능을 유지하는 새 기능)`);
	console.log(`  3. Patch — 셋째 자리: ${choices['3']} (버그 수정이나 작은 개선)`);
	console.log('  0. 취소\n');

	while (true) {
		const choice = (await rl.question('선택: ')).trim();
		if (!choice || choice === '0') return null;
		if (choices[choice]) return choices[choice];
		console.log('1, 2, 3 또는 0을 입력해 주세요.');
	}
}

async function main() {
	const state = verifyLocalState();
	console.log(`현재 릴리스: ${state.currentTag}`);
	console.log(`현재 브랜치: ${state.branch}`);
	console.log(`아직 릴리스되지 않은 커밋: ${state.commits.length}개\n`);
	for (const commit of state.commits) console.log(`  ${commit}`);

	const rl = createInterface({ input, output });
	const targetVersion = await chooseVersion(state.currentTag, rl);
	if (!targetVersion) {
		rl.close();
		console.log('\n릴리스를 취소했습니다.');
		return;
	}

	console.log(`\n${state.currentTag} → ${targetVersion}으로 올리고 커밋 ${state.commits.length}개를 공개합니다.`);
	const confirmed = (await rl.question('버전 커밋과 태그를 만들고 origin에 푸시할까요? (y/N) '))
		.trim()
		.toLowerCase();
	rl.close();
	if (confirmed !== 'y' && confirmed !== 'yes') {
		console.log('\n릴리스를 취소했습니다.');
		return;
	}

	verifyRemoteState(state.head);
	if (getCurrentTag() !== state.currentTag) fail('원격 확인 후 현재 릴리스 태그가 변경되었습니다. 다시 실행해 주세요.');
	verifyMetadata(state.currentTag);
	if (tagExists(targetVersion)) fail(`${targetVersion} 태그가 이미 존재합니다.`);

	let versionPrepared = false;
	let releaseCommitted = false;
	try {
		versionPrepared = true;
		runLive(npmCommand, ['version', targetVersion, '--no-git-tag-version']);
		verifyMetadata(targetVersion);
		runLive(npmCommand, ['run', 'lint']);
		runLive(npmCommand, ['run', 'build']);
		runLive('git', ['diff', '--check']);
		runLive('git', ['add', '--', ...VERSION_FILES]);
		runLive('git', ['diff', '--cached', '--check']);

		const staged = run('git', ['diff', '--cached', '--name-only']).split(/\r?\n/).filter(Boolean);
		if (staged.length !== VERSION_FILES.length || VERSION_FILES.some((file) => !staged.includes(file))) {
			fail(`예상하지 않은 staged 파일이 있습니다: ${staged.join(', ')}`);
		}

		runLive('git', ['commit', '-m', `Release ${targetVersion}`]);
		releaseCommitted = true;
		runLive('git', ['tag', targetVersion]);
		runLive('git', ['push', '--atomic', 'origin', 'main', targetVersion]);
	} catch (error) {
		if (versionPrepared && !releaseCommitted) {
			runLive('git', ['restore', '--staged', '--worktree', '--', ...VERSION_FILES]);
		}
		throw error;
	}

	console.log(`\n${targetVersion} 태그를 푸시했습니다. GitHub Actions가 릴리스를 생성합니다.`);
	const actionsUrl = repositoryUrl('actions/workflows/release.yml');
	const releaseUrl = repositoryUrl(`releases/tag/${targetVersion}`);
	if (actionsUrl) console.log(`Actions: ${actionsUrl}`);
	if (releaseUrl) console.log(`Release: ${releaseUrl}`);
}

main().catch((error) => {
	console.error(`\n릴리스 중단: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
