'use strict';

// Bounded native workflow. Only the caller-owned /tmp directory is removed, after daemon exit.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');

const worktree = path.resolve(__dirname, '..');
const manifestPath = path.join(__dirname, 'browser_instruction_approval.manifest.json');
const modulePath = process.env.TICKET23_PLAYWRIGHT_MODULE;
const executablePath = process.env.TICKET23_CHROMIUM_EXECUTABLE;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const sourcePaths = [
    'docs/ai-maintenance.md',
    'src/timetrace/interfaces/api/static/js/ai_assistant.js',
    'tests/test_ai_instruction_approval.cjs',
    'tests/test_ai_instruction_approval_api.py',
    'tests/browser_instruction_approval.js',
    'tests/browser_instruction_approval.manifest.json',
    'tests/run_browser_instruction_approval.js',
    'specs/ui-redesign.md',
];
const contextPaths = [
    '.scratch/ui-redesign/issues/23-instruction-approval.md',
    '.scratch/codex-continuation/ticket23-plan.md',
    '.scratch/codex-continuation/evidence/ticket-23/preflight-current/notes.md',
];
const fixtureScript = String.raw`
import json
import os
from pathlib import Path
from sqlmodel import Session
from timetrace.db.session import engine
from timetrace.services.ai_draft_service import AIDraftService
from timetrace.services.ai_instruction_service import AIInstructionService
from timetrace.services.ai_provider_service import AISettingsService

conversation_id = os.environ["TICKET23_CONVERSATION_ID"]
literal = '<script>window.__ticket23Injected=true</script>'
accepted_instruction = 'Accepted instruction from synthetic browser fixture'
conflict_instruction = '<img src=x onerror="window.__ticket23Injected=true"> ' + ('review text ' * 80)
task_title = 'Synthetic domain approval task'
with Session(engine) as db:
    AISettingsService(db).update_settings(custom_instructions=literal)
    instructions = AIInstructionService(db)
    save = instructions.create_proposal(conversation_id=conversation_id, source_message_id='ticket23-save', instruction='Initial save proposal')
    dismiss = instructions.create_proposal(conversation_id=conversation_id, source_message_id='ticket23-dismiss', instruction='Dismiss proposal')
    conflict = instructions.create_proposal(conversation_id=conversation_id, source_message_id='ticket23-conflict', instruction='Conflict proposal')
    drafts = AIDraftService(db)
    batch = drafts.create_batch(conversation_id, 'ticket23-task-draft', 'create_task', 'Synthetic task proposal', None, None)
    drafts.add_item(batch.id, 'create', 'task', None, {'title': task_title})
    fixture = {
        'conversationId': conversation_id,
        'saveProposalId': save.id,
        'dismissProposalId': dismiss.id,
        'conflictProposalId': conflict.id,
        'acceptedInstruction': accepted_instruction,
        'conflictInstruction': conflict_instruction,
        'taskBatchId': batch.id,
        'taskTitle': task_title,
        'initialInstructions': literal,
    }
Path(os.environ['TICKET23_FIXTURE_FILE']).write_text(json.dumps({
    **fixture,
}), encoding='utf-8')
`;

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function requireExact(ok, message) { if (!ok) throw new Error(message); }
function loadSourceBinding() {
    const mapPath = process.env.TICKET23_SOURCE_MAP_PATH;
    const expectedMapHash = process.env.TICKET23_SOURCE_MAP_SHA256;
    requireExact(typeof mapPath === 'string' && /^[a-f0-9]{64}$/.test(expectedMapHash || ''), 'Set the exact Ticket23 source-map path and SHA-256');
    const absoluteMapPath = path.resolve(mapPath);
    const mapStat = fs.lstatSync(absoluteMapPath);
    requireExact(mapStat.isFile() && !mapStat.isSymbolicLink(), 'Ticket23 source map must be a regular file');
    const mapBytes = fs.readFileSync(absoluteMapPath);
    const mapHash = sha256(mapBytes);
    requireExact(mapHash === expectedMapHash, 'Ticket23 source-map SHA-256 does not match the supplied release pin');
    const map = JSON.parse(mapBytes.toString('utf8'));
    const repositoryRoot = path.resolve(spawnSync('git', ['rev-parse', '--show-toplevel'], {cwd: worktree, encoding: 'utf8'}).stdout.trim());
    const commonGitDir = path.resolve(repositoryRoot, spawnSync('git', ['rev-parse', '--git-common-dir'], {cwd: worktree, encoding: 'utf8'}).stdout.trim());
    const commonRoot = path.dirname(commonGitDir);
    const sourceHead = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: worktree, encoding: 'utf8'}).stdout.trim();
    requireExact(map.sourceHead === sourceHead, 'Candidate HEAD does not match the source map');
    requireExact(Object.keys(map.files || {}).sort().join('\n') === [...sourcePaths].sort().join('\n'), 'Source map does not cover the exact Ticket23 source/spec set');
    requireExact(Object.keys(map.contextFiles || {}).sort().join('\n') === [...contextPaths].sort().join('\n'), 'Source map does not cover the exact approved ticket/preflight context');
    const files = {};
    const contextFiles = {};
    for (const [basePath, relativePaths, destination] of [[repositoryRoot, sourcePaths, files], [commonRoot, contextPaths, contextFiles]]) {
        for (const relativePath of relativePaths) {
            const absolutePath = path.resolve(basePath, relativePath);
            requireExact(absolutePath.startsWith(`${basePath}${path.sep}`), `Mapped file escaped repository: ${relativePath}`);
            const stat = fs.lstatSync(absolutePath);
            requireExact(stat.isFile() && !stat.isSymbolicLink(), `Mapped candidate is not a regular file: ${relativePath}`);
            const hash = sha256(fs.readFileSync(absolutePath));
            const expected = destination === files ? map.files[relativePath] : map.contextFiles[relativePath];
            requireExact(hash === expected, `Candidate source hash mismatch: ${relativePath}`);
            destination[relativePath] = hash;
        }
    }
    return {path: absoluteMapPath, sha256: mapHash, sourceHead, repositoryRoot, commonRoot, files, contextFiles, runtime: map.runtime};
}
function verifySourceBinding(binding) {
    const currentHead = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: worktree, encoding: 'utf8'}).stdout.trim();
    requireExact(currentHead === binding.sourceHead, 'Candidate HEAD changed during the run');
    for (const [relativePath, expectedHash] of Object.entries(binding.files)) {
        const bytes = fs.readFileSync(path.resolve(binding.repositoryRoot, relativePath));
        requireExact(sha256(bytes) === expectedHash, `Candidate source changed during the run: ${relativePath}`);
    }
    for (const [relativePath, expectedHash] of Object.entries(binding.contextFiles)) {
        const bytes = fs.readFileSync(path.resolve(binding.commonRoot, relativePath));
        requireExact(sha256(bytes) === expectedHash, `Approved context changed during the run: ${relativePath}`);
    }
}
function waitForExit(child, milliseconds) {
    return new Promise((resolve, reject) => {
        if (child.exitCode !== null || child.signalCode !== null) {
            resolve({code: child.exitCode, signal: child.signalCode});
            return;
        }
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for PID ${child.pid} to exit`)), milliseconds);
        child.once('exit', (code, signal) => { clearTimeout(timer); resolve({code, signal}); });
        child.once('error', error => { clearTimeout(timer); reject(error); });
    });
}
const auditScript = String.raw`
import json
import os
import sqlite3
from pathlib import Path

fixture = json.loads(Path(os.environ['TICKET23_FIXTURE_FILE']).read_text(encoding='utf-8'))
connection = sqlite3.connect(os.environ['TIMETRACE_DB_FILE'])
connection.row_factory = sqlite3.Row
try:
    integrity = connection.execute('PRAGMA integrity_check').fetchone()[0]
    proposals = connection.execute(
        'SELECT id, status FROM aiinstructionproposal WHERE id IN (?, ?, ?) ORDER BY id',
        (fixture['saveProposalId'], fixture['dismissProposalId'], fixture['conflictProposalId']),
    ).fetchall()
    settings = connection.execute('SELECT custom_instructions FROM aisettings').fetchall()
    batches = connection.execute('SELECT id, status FROM aidraftbatch WHERE id = ?', (fixture['taskBatchId'],)).fetchall()
    tasks = connection.execute('SELECT id, title FROM task WHERE title = ?', (fixture['taskTitle'],)).fetchall()
    result = {
        'integrityCheck': integrity,
        'instructionProposals': [dict(row) for row in proposals],
        'customInstructions': settings[0]['custom_instructions'] if len(settings) == 1 else None,
        'draftBatches': [dict(row) for row in batches],
        'syntheticTasks': [dict(row) for row in tasks],
    }
    result['matchesExpected'] = (
        integrity == 'ok'
        and {row['id']: row['status'] for row in proposals} == {
            fixture['saveProposalId']: 'accepted',
            fixture['dismissProposalId']: 'rejected',
            fixture['conflictProposalId']: 'conflict',
        }
        and result['customInstructions'] == fixture['initialInstructions'] + '\n\n' + fixture['acceptedInstruction']
        and len(batches) == 1 and batches[0]['status'] == 'applied'
        and len(tasks) == 1
    )
    print(json.dumps(result))
finally:
    connection.close()
`;
async function unusedLoopbackPort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return port;
}
function runUv(args, env, input) {
    const result = spawnSync('uv', args, {cwd: worktree, env, encoding: 'utf8', input, timeout: 120000, maxBuffer: 4 * 1024 * 1024});
    if (result.error || result.status !== 0) throw new Error(`uv ${args.join(' ')} failed: ${result.error || result.stderr || result.stdout}`);
    return result.stdout.trim();
}
function pathAllowed(routes, method, pathAndQuery) {
    return routes.some(route => {
        if (route.method !== method) return false;
        const pattern = route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^}]+\\\}/g, '[^/]+');
        return new RegExp(`^${pattern}$`).test(pathAndQuery);
    });
}
function appendCapped(array, item, limit, overflow, key) {
    if (array.length < limit) array.push(item);
    else overflow[key] += 1;
}
function captureBody(bytes, perBodyLimit, totalState, totalLimit) {
    const keptBytes = Math.min(bytes.length, perBodyLimit, Math.max(0, totalLimit - totalState.bytes));
    totalState.bytes += keptBytes;
    return {
        bodyBytes: bytes.length,
        bodySha256: sha256(bytes),
        bodyBase64: bytes.subarray(0, keptBytes).toString('base64'),
        bodyTruncated: keptBytes < bytes.length,
    };
}
function captureRequestBody(value, captureState) {
    if (value == null) return null;
    const text = String(value);
    const perBodyLimit = 16 * 1024;
    const totalLimit = 256 * 1024;
    const byteLength = Buffer.byteLength(text);
    const kept = Math.min(byteLength, perBodyLimit, Math.max(0, totalLimit - captureState.requestBytes));
    const prefix = [];
    let prefixBytes = 0;
    for (const character of text) {
        const characterBytes = Buffer.byteLength(character);
        if (prefixBytes + characterBytes > kept) break;
        prefix.push(character);
        prefixBytes += characterBytes;
    }
    const prefixBytesBuffer = Buffer.from(prefix.join(''));
    captureState.requestBytes += kept;
    const truncated = kept < byteLength;
    if (truncated) captureState.overflow.requestBodyTruncated += 1;
    return {
        requestBodyBytes: byteLength,
        requestBodySha256: crypto.createHash('sha256').update(text).digest('hex'),
        requestBodyBase64: prefixBytesBuffer.toString('base64'),
        requestBodyTruncated: truncated,
    };
}
async function captureStreamBody(stream, perBodyLimit, totalState, totalLimit) {
    if (!stream) return captureBody(Buffer.alloc(0), perBodyLimit, totalState, totalLimit);
    const hash = crypto.createHash('sha256');
    const chunks = [];
    const cap = Math.min(perBodyLimit, Math.max(0, totalLimit - totalState.bytes));
    let bodyBytes = 0;
    let keptBytes = 0;
    for await (const chunk of stream) {
        const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        hash.update(bytes);
        bodyBytes += bytes.length;
        const keep = Math.min(bytes.length, Math.max(0, cap - keptBytes));
        if (keep) {
            chunks.push(bytes.subarray(0, keep));
            keptBytes += keep;
        }
    }
    totalState.bytes += keptBytes;
    return {
        bodyBytes,
        bodySha256: hash.digest('hex'),
        bodyBase64: Buffer.concat(chunks, keptBytes).toString('base64'),
        bodyTruncated: keptBytes < bodyBytes,
        bytes: Buffer.concat(chunks, keptBytes),
    };
}
async function captureBoundedLog(logPath, byteLimit = 256 * 1024) {
    if (!logPath || !fs.existsSync(logPath)) return null;
    const stat = fs.statSync(logPath);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(logPath, {highWaterMark: 64 * 1024})) hash.update(chunk);
    const half = Math.floor(byteLimit / 2);
    const fd = fs.openSync(logPath, 'r');
    try {
        const head = Buffer.alloc(Math.min(stat.size, half));
        if (head.length) fs.readSync(fd, head, 0, head.length, 0);
        const tailStart = Math.max(head.length, stat.size - half);
        const tail = Buffer.alloc(Math.max(0, stat.size - tailStart));
        if (tail.length) fs.readSync(fd, tail, 0, tail.length, tailStart);
        return {bytes: stat.size, sha256: hash.digest('hex'), truncated: stat.size > byteLimit, head: head.toString('utf8'), tail: tail.toString('utf8')};
    } finally { fs.closeSync(fd); }
}
async function hashFile(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath, {highWaterMark: 64 * 1024})) hash.update(chunk);
    return hash.digest('hex');
}
async function bootstrapFetch(origin, method, pathAndQuery, options, ledger, captureState, mutations) {
    requireExact(pathAllowed(manifest.bootstrap_api_routes, method, pathAndQuery), `Unlisted runner bootstrap request: ${method} ${pathAndQuery}`);
    const url = new URL(pathAndQuery, origin);
    requireExact(url.origin === origin, `Bootstrap request escaped the loopback origin: ${url.origin}`);
    const requestBody = captureRequestBody(options?.body, captureState);
    const mutation = method === 'GET' ? null : {phase: 'runner-bootstrap', method, path: pathAndQuery, ...requestBody, ack: null};
    if (mutation) mutations.push(mutation);
    let response = null;
    try {
        response = await fetch(url, options);
        if (mutation) mutation.ack = {status: response.status};
        const captured = await captureStreamBody(response.body, captureState.perBodyLimit, captureState, captureState.totalLimit);
        const bytes = captured.bytes;
        const entry = {
            method,
            path: pathAndQuery,
            action: 'continued',
            ...requestBody,
            status: response.status,
            bodyBytes: captured.bodyBytes,
            bodySha256: captured.bodySha256,
            bodyBase64: captured.bodyBase64,
            bodyTruncated: captured.bodyTruncated,
        };
        if (captured.bodyTruncated) captureState.overflow.responseCaptureFailures += 1;
        if (mutation) mutation.ack.bodySha256 = entry.bodySha256;
        appendCapped(ledger, entry, captureState.ledgerLimit, captureState.overflow, 'bootstrapLedger');
        return {response, bytes, bodyText: bytes.toString('utf8')};
    } catch (error) {
        if (mutation) mutation.failure = String(error);
        appendCapped(ledger, {
            method,
            path: pathAndQuery,
            action: response ? 'response-body-failed' : 'failed',
            ...requestBody,
            status: response?.status ?? null,
            error: String(error),
        }, captureState.ledgerLimit, captureState.overflow, 'bootstrapLedger');
        throw error;
    }
}
async function waitForHealth(origin, child, expectedDb, expectedPort, ledger, captureState) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (child.exitCode !== null) throw new Error(`Daemon exited early: ${child.exitCode}`);
        try {
            const {response, bodyText} = await bootstrapFetch(origin, 'GET', '/health', {signal: AbortSignal.timeout(1000)}, ledger, captureState, captureState.mutations);
            const body = JSON.parse(bodyText);
            if (response.ok && body.status === 'ok') {
                assert.equal(body.db_file, expectedDb);
                assert.equal(body.port, expectedPort);
                return body;
            }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Scratch daemon did not serve /health within 10 seconds');
}
async function confirmDaemonStopped(origin, ledger, captureState) {
    const probes = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const result = await bootstrapFetch(origin, 'GET', '/health', {signal: AbortSignal.timeout(800)}, ledger, captureState, captureState.mutations);
            probes.push({status: result.response.status, closed: false});
            return {portClosed: false, probes};
        } catch (error) {
            const code = error?.cause?.code || null;
            const refused = code === 'ECONNREFUSED' || /ECONNREFUSED/.test(String(error));
            probes.push({closed: refused, error: String(error), code});
            if (!refused) return {portClosed: false, probes};
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return {portClosed: probes.length === 2 && probes.every(probe => probe.closed), probes};
}
function allowlisted(method, pathAndQuery) {
    return pathAllowed(manifest.browser_api_routes, method, pathAndQuery);
}

async function main() {
    requireExact(typeof modulePath === 'string' && typeof executablePath === 'string', 'Set the exact external Playwright module and Chromium executable paths');
    const evidenceDir = path.resolve(worktree, '../../evidence/ticket-23/native');
    fs.mkdirSync(evidenceDir, {recursive: true});
    const attemptId = process.env.TICKET23_ATTEMPT_ID || `attempt-${Date.now()}`;
    requireExact(/^[a-z0-9][a-z0-9-]{0,63}$/.test(attemptId), 'Attempt id must be a short lowercase filename token');
    let root = null, tmp, home, runtime, browserEnv, launchOptions, daemonExecutable, dbFile, fixtureFile, origin, port, sourceBinding = null, appStorage = null;
    let realModule = null, realExecutable = null, chromium = null;
    let browser, context, daemon, daemonLog, constructorProbe = null, primaryError = null, result = null, health = null, timerStatus = null, browserVersion = null;
    let preflightBrowserClosed = true;
    let browserClosed = false, contextClosed = false, daemonExit = null, daemonExitProof = null, shutdownError = null, scratchAudit = null, daemonLogCapture = null;
    let evidenceDurable = false, rootRemoved = false, cleanupError = null;
    const routeDenials = [], expectedNetworkBlocks = [], requestLedger = [], bootstrapLedger = [];
    const responses = [], pendingCaptures = [], mutations = [], mutationRequests = new Map(), requestRecords = new Map();
    const faults = {failNextStatus: false, failNextSettingsRead: false, statusFailures: 0, settingsFailures: 0};
    const responseCaptureLimit = 64 * 1024;
    const responseCaptureTotalLimit = 2 * 1024 * 1024;
    const overflow = {bootstrapLedger: 0, requestLedger: 0, routeDenials: 0, expectedNetworkBlocks: 0, responses: 0, requestBodyTruncated: 0, responseCaptureFailures: 0, requestFailures: 0};
    const captureState = {perBodyLimit: responseCaptureLimit, totalLimit: responseCaptureTotalLimit, bytes: 0, requestBytes: 0, ledgerLimit: 120, overflow, mutations};
    try {
        sourceBinding = loadSourceBinding();
        const runtimePin = sourceBinding.runtime;
        requireExact(runtimePin && typeof runtimePin === 'object', 'Source map must pin the browser runtime');
        requireExact(typeof runtimePin.playwrightModule === 'string' && typeof runtimePin.playwrightVersion === 'string', 'Source map must pin Playwright path and version');
        requireExact(typeof runtimePin.chromiumExecutable === 'string' && typeof runtimePin.chromiumVersion === 'string', 'Source map must pin Chromium path and version');
        requireExact(Number.isSafeInteger(runtimePin.chromiumSizeBytes) && runtimePin.chromiumSizeBytes > 0, 'Source map must pin Chromium executable size');
        requireExact(runtimePin.chromiumMode === '0755', 'Source map Chromium mode must be the reviewed executable mode');
        realModule = fs.realpathSync(modulePath);
        requireExact(realModule === runtimePin.playwrightModule, 'Playwright module does not match the source-map path pin');
        const packagePath = path.join(realModule, 'package.json');
        const packageStat = fs.lstatSync(packagePath);
        requireExact(packageStat.isFile() && !packageStat.isSymbolicLink() && fs.realpathSync(packagePath) === packagePath, 'Playwright package metadata must be a regular pinned file');
        const packageMetadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        requireExact(packageMetadata.version === runtimePin.playwrightVersion, 'Playwright package version does not match the source-map pin');
        realExecutable = fs.realpathSync(executablePath);
        requireExact(realExecutable === runtimePin.chromiumExecutable, 'Chromium executable does not match the source-map path pin');
        const executableStat = fs.statSync(realExecutable);
        requireExact(executableStat.isFile() && executableStat.size === runtimePin.chromiumSizeBytes, 'Chromium executable size does not match the source-map pin');
        requireExact((executableStat.mode & 0o777).toString(8).padStart(4, '0') === runtimePin.chromiumMode, 'Chromium executable mode does not match the source-map pin');
        fs.accessSync(realExecutable, fs.constants.X_OK);
        ({chromium} = require(realModule));
        root = fs.mkdtempSync('/tmp/t23-');
        const rootStat = fs.statSync(root);
        requireExact((rootStat.mode & 0o777) === 0o700, 'Scratch root must be private mode 0700');
        tmp = path.join(root, 'tmp');
        home = path.join(root, 'home');
        runtime = path.join(root, 'run');
        for (const directory of [tmp, home, runtime]) fs.mkdirSync(directory, {recursive: true, mode: 0o700});
        browserEnv = {
            HOME: home,
            PATH: process.env.PATH || '/usr/bin:/bin',
            TMPDIR: tmp,
            XDG_CACHE_HOME: path.join(root, 'cache'),
            XDG_CONFIG_HOME: path.join(root, 'config'),
            XDG_RUNTIME_DIR: runtime,
            LANG: 'C.UTF-8',
        };
        fs.mkdirSync(browserEnv.XDG_CACHE_HOME, {recursive: true, mode: 0o700});
        fs.mkdirSync(browserEnv.XDG_CONFIG_HOME, {recursive: true, mode: 0o700});
        launchOptions = {
            headless: true,
            executablePath: realExecutable,
            env: browserEnv,
            args: ['--no-sandbox'],
            timeout: 15000,
        };
        requireExact(JSON.stringify(Object.keys(launchOptions).sort()) === JSON.stringify(['args', 'env', 'executablePath', 'headless', 'timeout']), 'Unexpected Playwright launch configuration keys');
        requireExact(launchOptions.executablePath === realExecutable && launchOptions.headless === true && launchOptions.args.length === 1 && launchOptions.args[0] === '--no-sandbox', 'Playwright launch config does not match the audited executable/headless options');
        requireExact(Buffer.byteLength(path.join(tmp, 'playwright_chromiumdev_profile-xxxxxxxx')) < 108, 'Chromium profile/socket path exceeds the short-path bound');

        // Exact executable/config constructor probe is completed before the app starts.
        constructorProbe = await chromium.launch(launchOptions);
        preflightBrowserClosed = false;
        browserVersion = constructorProbe.version();
        await constructorProbe.close();
        constructorProbe = null;
        preflightBrowserClosed = true;
        requireExact(browserVersion === runtimePin.chromiumVersion, 'Chromium constructor version does not match the source-map pin');

        dbFile = path.join(root, 'timetrace.db');
        fixtureFile = path.join(root, 'fixture.json');
        daemonExecutable = fs.realpathSync(path.join(worktree, '.venv/bin/timetrace'));
        fs.accessSync(daemonExecutable, fs.constants.X_OK);
        port = await unusedLoopbackPort();
        requireExact(port !== 8002, 'Scratch daemon must not use the personal default port');
        origin = `http://127.0.0.1:${port}`;
        const appEnv = {
            PATH: process.env.PATH || '/usr/bin:/bin',
            LANG: process.env.LANG || 'C.UTF-8',
            HOME: home,
            TIMETRACE_DB_FILE: dbFile,
            TIMETRACE_HOST: '127.0.0.1',
            TIMETRACE_PORT: String(port),
            TIMETRACE_IDLE_DETECTION_ENABLED: 'false',
            UV_CACHE_DIR: path.join(root, 'uv-cache'),
            UV_OFFLINE: 'true',
            TMPDIR: tmp,
            XDG_CACHE_HOME: path.join(root, 'app-cache'),
            XDG_CONFIG_HOME: path.join(root, 'app-config'),
            XDG_RUNTIME_DIR: runtime,
            TICKET23_FIXTURE_FILE: fixtureFile,
        };
        appStorage = {
            home: appEnv.HOME,
            tmp: appEnv.TMPDIR,
            uvCache: appEnv.UV_CACHE_DIR,
            xdgCache: appEnv.XDG_CACHE_HOME,
            xdgConfig: appEnv.XDG_CONFIG_HOME,
            runtime: appEnv.XDG_RUNTIME_DIR,
            daemonExecutable,
            daemonExecutableSha256: sha256(fs.readFileSync(daemonExecutable)),
            idleDetectionEnabled: appEnv.TIMETRACE_IDLE_DETECTION_ENABLED,
            inheritedEnvironment: 'controlled allowlist: PATH and LANG only before private overrides',
        };
        for (const directory of [appEnv.UV_CACHE_DIR, appEnv.XDG_CACHE_HOME, appEnv.XDG_CONFIG_HOME]) {
            fs.mkdirSync(directory, {recursive: true, mode: 0o700});
        }
        runUv(['run', 'timetrace', 'db', 'migrate'], appEnv);
        daemonLog = fs.openSync(path.join(root, 'daemon.log'), 'w', 0o600);
        daemon = spawn(daemonExecutable, ['daemon'], {cwd: worktree, env: appEnv, stdio: ['ignore', daemonLog, daemonLog]});
        health = await waitForHealth(origin, daemon, dbFile, port, bootstrapLedger, captureState);
        requireExact(path.resolve(health.db_file) === path.resolve(dbFile), 'Health DB identity does not match the exact allocated scratch DB');
        const timerRequest = await bootstrapFetch(origin, 'GET', '/api/timer/status', {signal: AbortSignal.timeout(5000)}, bootstrapLedger, captureState, mutations);
        timerStatus = JSON.parse(timerRequest.bodyText);
        const timerResponse = timerRequest.response;
        assert.equal(timerResponse.status, 200);
        assert.equal(timerStatus.is_running, false);
        assert.equal(timerStatus.idle_detection_enabled, false);
        assert.equal(timerStatus.is_frozen_idle, false);
        assert.equal(timerStatus.pending_idle_gap, null);
        const conversationRequest = await bootstrapFetch(origin, 'POST', '/api/ai/conversations', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}', signal: AbortSignal.timeout(5000),
        }, bootstrapLedger, captureState, mutations);
        const conversationResponse = conversationRequest.response;
        const conversation = JSON.parse(conversationRequest.bodyText);
        requireExact(conversationResponse.status === 201, `Synthetic conversation fixture returned ${conversationResponse.status}`);
        appEnv.TICKET23_CONVERSATION_ID = conversation.id;
        runUv(['run', 'python', '-P', '-'], appEnv, fixtureScript);
        const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
        const verifyRequest = await bootstrapFetch(origin, 'GET', `/api/ai/conversations/${fixture.conversationId}`, {signal: AbortSignal.timeout(5000)}, bootstrapLedger, captureState, mutations);
        const verifyResponse = verifyRequest.response;
        const verifyFixture = JSON.parse(verifyRequest.bodyText);
        assert.equal(verifyResponse.status, 200);
        assert.equal(verifyFixture.instruction_proposals.length, 3);
        assert.equal(verifyFixture.instruction_proposals.every(proposal => proposal.status === 'pending'), true);

        const config = {viewport: {width: 1440, height: 900}, serviceWorkers: 'block', acceptDownloads: false};
        requireExact(JSON.stringify(Object.keys(config).sort()) === JSON.stringify(['acceptDownloads', 'serviceWorkers', 'viewport']), 'Unexpected browser context config');
        browser = await chromium.launch(launchOptions);
        assert.equal(browser.version(), browserVersion);
        assert.equal(browser.version(), sourceBinding.runtime.chromiumVersion, 'Browser runtime matches the pinned Chromium version');
        context = await browser.newContext(config);
        const page = await context.newPage();
        page.on('response', response => {
            const capture = (async () => {
                const url = new URL(response.url());
                if (url.origin !== origin) return;
                const headers = response.headers();
                const request = response.request();
                const pathAndQuery = url.pathname + url.search;
                const requestRecord = requestRecords.get(request);
                if (requestRecord) requestRecord.status = response.status();
                const mutation = mutationRequests.get(request);
                if (mutation) mutation.ack = {status: response.status()};
                if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/static/')) return;
                const captureOriginalBody = url.pathname.startsWith('/api/') || url.pathname === '/settings/ai' || url.pathname === '/static/js/ai_assistant.js';
                if (!captureOriginalBody) {
                    appendCapped(responses, {method: request.method(), path: pathAndQuery, status: response.status(), contentType: headers['content-type'] || '', contentLength: headers['content-length'] || null, bodyCaptured: false}, 300, overflow, 'responses');
                    return;
                }
                const declaredLength = Number(headers['content-length']);
                if (!headers['content-length'] || !Number.isFinite(declaredLength)) {
                    overflow.responseCaptureFailures += 1;
                    appendCapped(responses, {method: request.method(), path: pathAndQuery, status: response.status(), contentType: headers['content-type'] || '', contentLength: headers['content-length'] || null, captureError: 'Response has no bounded Content-Length; body capture skipped'}, 300, overflow, 'responses');
                    if (mutation) mutation.ack.captureError = 'Response has no bounded Content-Length; body capture skipped';
                    return;
                }
                if (Number.isFinite(declaredLength) && declaredLength > responseCaptureLimit) {
                    overflow.responseCaptureFailures += 1;
                    appendCapped(responses, {method: request.method(), path: pathAndQuery, status: response.status(), contentType: headers['content-type'] || '', contentLength: declaredLength, captureError: 'Response exceeded the bounded capture size'}, 300, overflow, 'responses');
                    if (mutation) mutation.ack.captureError = 'Response exceeded the bounded capture size';
                    return;
                }
                try {
                    const body = await response.body();
                    if (body.length > responseCaptureLimit || body.length !== declaredLength) {
                        throw new Error('Response body did not match its bounded Content-Length');
                    }
                    const record = {method: request.method(), path: pathAndQuery, status: response.status(), contentType: headers['content-type'] || ''};
                    Object.assign(record, captureBody(body, responseCaptureLimit, captureState, responseCaptureTotalLimit));
                    if (record.bodyTruncated) overflow.responseCaptureFailures += 1;
                    appendCapped(responses, record, 300, overflow, 'responses');
                    if (mutation) mutation.ack.bodySha256 = sha256(body);
                } catch (error) {
                    overflow.responseCaptureFailures += 1;
                    appendCapped(responses, {method: request.method(), path: pathAndQuery, status: response.status(), captureError: String(error)}, 300, overflow, 'responses');
                    if (mutation) mutation.ack.captureError = String(error);
                }
            })();
            pendingCaptures.push(capture);
        });
        page.on('requestfailed', request => {
            const requestRecord = requestRecords.get(request);
            if (requestRecord) {
                overflow.requestFailures += 1;
                requestRecord.failure = request.failure()?.errorText || 'unknown request failure';
            }
            const mutation = mutationRequests.get(request);
            if (mutation) mutation.failure = request.failure()?.errorText || 'unknown request failure';
        });
        await context.route('**/*', async route => {
            const request = route.request();
            const url = new URL(request.url());
            if (requestLedger.length >= 300) {
                overflow.requestLedger += 1;
                await route.abort('blockedbyclient');
                return;
            }
            if (url.origin !== origin) {
                appendCapped(expectedNetworkBlocks, {method: request.method(), origin: url.origin, reason: 'non-loopback origin blocked by manifest'}, 100, overflow, 'expectedNetworkBlocks');
                requestLedger.push({method: request.method(), origin: url.origin, action: 'blocked'});
                await route.abort('blockedbyclient');
                return;
            }
            const pathAndQuery = url.pathname + url.search;
            if (url.pathname.startsWith('/api/')) {
                if (!allowlisted(request.method(), pathAndQuery)) {
                    appendCapped(routeDenials, {method: request.method(), path: pathAndQuery, reason: 'unlisted API request blocked'}, 100, overflow, 'routeDenials');
                    requestLedger.push({method: request.method(), path: pathAndQuery, action: 'blocked'});
                    await route.abort('blockedbyclient');
                    return;
                }
                const requestRecord = {method: request.method(), path: pathAndQuery, action: 'continued'};
                requestLedger.push(requestRecord);
                requestRecords.set(request, requestRecord);
                if (request.method() !== 'GET') {
                    const mutation = {method: request.method(), path: url.pathname, ...captureRequestBody(request.postData(), captureState), ack: null};
                    mutations.push(mutation);
                    mutationRequests.set(request, mutation);
                }
                if (request.method() === 'GET' && url.pathname === '/api/ai/status' && faults.failNextStatus) {
                    faults.failNextStatus = false;
                    faults.statusFailures += 1;
                    await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({detail: 'Synthetic ticket23 read failure'})});
                    return;
                }
                if (request.method() === 'GET' && url.pathname === '/api/ai/settings' && faults.failNextSettingsRead) {
                    faults.failNextSettingsRead = false;
                    faults.settingsFailures += 1;
                    await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({detail: 'Synthetic ticket23 Settings read failure'})});
                    return;
                }
                await route.continue();
                return;
            }
            const pageRequestRecord = {method: request.method(), path: pathAndQuery, action: 'continued'};
            const allowedPage = manifest.page_paths.includes(url.pathname) && request.method() === 'GET';
            const allowedStatic = manifest.static_paths.includes(url.pathname) && request.method() === 'GET';
            const allowedFavicon = url.pathname === '/favicon.ico' && request.method() === 'GET';
            if (!allowedPage && !allowedStatic && !allowedFavicon) {
                appendCapped(routeDenials, {method: request.method(), path: pathAndQuery, reason: 'unlisted same-origin path blocked'}, 100, overflow, 'routeDenials');
                pageRequestRecord.action = 'blocked';
                requestLedger.push(pageRequestRecord);
                await route.abort('blockedbyclient');
                return;
            }
            requestLedger.push(pageRequestRecord);
            requestRecords.set(request, pageRequestRecord);
            await route.continue();
        });

        const probe = require(path.join(__dirname, 'browser_instruction_approval.js'));
        const ledger = {mutations};
        result = await probe({page, baseURL: origin, fixture, ledger, faults});
        await Promise.allSettled(pendingCaptures);
        const assistantScript = responses.find(entry => entry.method === 'GET' && entry.path === '/static/js/ai_assistant.js');
        requireExact(assistantScript?.status === 200 && assistantScript.bodySha256 === sourceBinding.files['src/timetrace/interfaces/api/static/js/ai_assistant.js'], 'Daemon served AI assistant JavaScript does not match the pinned candidate bytes');
        assert.deepEqual(routeDenials, [], `Browser attempted requests outside the manifest: ${JSON.stringify(routeDenials)}`);
        assert.equal(mutations.filter(entry => entry.method === 'POST' && entry.path.endsWith('/accept')).length, 3, 'two explicit instruction accepts, including one 409, plus one task-batch accept');
        assert.equal(mutations.filter(entry => entry.method === 'POST' && entry.path.endsWith('/reject')).length, 1);
        result = {...result, origin, browserVersion, browserExecutable: realExecutable, health, timerStatus, routeDenials, expectedNetworkBlocks, requestLedger, responseCaptures: responses, mutations};
        await context.close();
        context = null;
        contextClosed = true;
    } catch (error) {
        primaryError = String(error?.stack || error);
    } finally {
        if (constructorProbe) {
            try {
                await constructorProbe.close();
                constructorProbe = null;
                preflightBrowserClosed = true;
            } catch (error) {
                shutdownError = `Preflight Chromium close failed: ${String(error)}`;
            }
        }
        if (context) {
            try { await context.close(); contextClosed = true; }
            catch (error) { shutdownError = `Browser context close failed: ${String(error)}`; }
        } else contextClosed = true;
        if (browser) {
            try { await browser.close(); browserClosed = true; }
            catch (error) { shutdownError = `${shutdownError ? `${shutdownError}; ` : ''}Playwright close failed: ${String(error)}`; }
        } else browserClosed = true;
        if (daemon) {
            try {
                if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill('SIGTERM');
                daemonExit = await waitForExit(daemon, 10000);
            } catch (termError) {
                try {
                    daemon.kill('SIGKILL');
                    daemonExit = await waitForExit(daemon, 5000);
                } catch (killError) {
                    shutdownError = `${shutdownError ? `${shutdownError}; ` : ''}daemon shutdown unconfirmed: ${String(termError)}; ${String(killError)}`;
                }
            }
        }
        if (daemonExit && origin) daemonExitProof = await confirmDaemonStopped(origin, bootstrapLedger, captureState);
        if (daemonLog !== undefined) fs.closeSync(daemonLog);
        await Promise.allSettled(pendingCaptures);
        if (sourceBinding) {
            try { verifySourceBinding(sourceBinding); }
            catch (error) { primaryError = primaryError || String(error); }
        }
        const daemonLogPath = root && path.join(root, 'daemon.log');
        try { daemonLogCapture = await captureBoundedLog(daemonLogPath); }
        catch (error) { overflow.responseCaptureFailures += 1; daemonLogCapture = {error: String(error)}; }
        let storageFiles = null;
        if (root) {
            storageFiles = {};
            for (const filePath of [dbFile, dbFile && `${dbFile}-wal`, dbFile && `${dbFile}-shm`, path.join(root, 'active_timer.json')].filter(Boolean)) {
                try {
                    const stat = fs.statSync(filePath);
                    storageFiles[path.basename(filePath)] = {exists: true, dev: stat.dev, ino: stat.ino, size: stat.size, mode: stat.mode & 0o777, sha256: await hashFile(filePath)};
                } catch (error) { storageFiles[path.basename(filePath)] = {exists: false, error: error.code || String(error)}; }
            }
        }
        if (daemonExit && browserClosed && dbFile && fixtureFile && fs.existsSync(fixtureFile)) {
            try {
                const auditEnv = {
                    PATH: process.env.PATH || '/usr/bin:/bin',
                    LANG: process.env.LANG || 'C.UTF-8',
                    HOME: home,
                    TIMETRACE_DB_FILE: dbFile,
                    TICKET23_FIXTURE_FILE: fixtureFile,
                    UV_CACHE_DIR: path.join(root, 'uv-cache'),
                    UV_OFFLINE: 'true',
                };
                scratchAudit = JSON.parse(runUv(['run', 'python', '-P', '-'], auditEnv, auditScript));
            } catch (error) { scratchAudit = {error: String(error), matchesExpected: false}; }
        }
        const receipt = {
            format: 1,
            attemptId,
            passed: false,
            primaryError,
            run: result,
            sourceHead: sourceBinding?.sourceHead || spawnSync('git', ['rev-parse', 'HEAD'], {cwd: worktree, encoding: 'utf8'}).stdout.trim(),
            sourceBinding,
            browser: {module: realModule, executable: realExecutable, version: browserVersion, profileSocketBytes: tmp ? Buffer.byteLength(path.join(tmp, 'playwright_chromiumdev_profile-xxxxxxxx')) : null},
            daemonExecutable: daemonExecutable ? {path: daemonExecutable, sha256: sha256(fs.readFileSync(daemonExecutable))} : null,
            scratchIdentity: root ? {root, database: dbFile, timerState: path.join(root, 'active_timer.json'), port, origin, rootDev: fs.statSync(root).dev, rootIno: fs.statSync(root).ino, rootMode: fs.statSync(root).mode & 0o777, appStorage, storageFiles} : null,
            health,
            timerStatus,
            bootstrapLedger,
            routeDenials,
            expectedNetworkBlocks,
            requestLedger,
            responseCaptures: responses,
            evidenceOverflows: overflow,
            mutations,
            faults,
            scratchAudit,
            daemonLog: daemonLogCapture,
            shutdown: {pid: daemon?.pid || null, executable: daemonExecutable || null, preflightBrowserClosed, contextClosed, browserClosed, daemonExit, daemonExitProof, error: shutdownError},
            cleanup: {rootRemoval: 'pending-after-pre-cleanup-receipt', rootRemoved: null, evidenceDurable: false, error: null},
        };
        const evidencePath = path.join(evidenceDir, `${attemptId}.json`);
        const writeEvidence = () => {
            const temporary = `${evidencePath}.${process.pid}.tmp`;
            const fd = fs.openSync(temporary, 'w', 0o600);
            try { fs.writeFileSync(fd, `${JSON.stringify(receipt, null, 2)}\n`); fs.fsyncSync(fd); }
            finally { fs.closeSync(fd); }
            fs.renameSync(temporary, evidencePath);
            const directory = fs.openSync(evidenceDir, 'r');
            try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
        };
        try { writeEvidence(); evidenceDurable = true; }
        catch (error) { cleanupError = `Could not durably write pre-cleanup receipt: ${String(error)}`; }
        const sourceAndRouteChecksPassed = !primaryError && Boolean(result) && routeDenials.length === 0 && Object.values(overflow).every(count => count === 0);
        const daemonStoppedCleanly = daemonExit?.code === 0 && daemonExitProof?.portClosed === true && /Application shutdown complete/.test(`${daemonLogCapture?.head || ''}${daemonLogCapture?.tail || ''}`);
        const safeToRemove = Boolean(root && daemonStoppedCleanly && preflightBrowserClosed && contextClosed && browserClosed && scratchAudit?.matchesExpected && evidenceDurable && sourceAndRouteChecksPassed && !shutdownError);
        if (safeToRemove) {
            try { fs.rmSync(root, {recursive: true, force: false}); rootRemoved = true; }
            catch (error) { cleanupError = String(error); }
        } else if (root) cleanupError = cleanupError || 'Scratch root retained because daemon exit, browser close, DB audit, or durable evidence is unconfirmed';
        receipt.cleanup = {rootRemoval: rootRemoved ? 'removed-after-durable-audit' : 'retained', rootRemoved, evidenceDurable, error: cleanupError};
        receipt.shutdown.contextClosed = contextClosed;
        receipt.passed = sourceAndRouteChecksPassed && daemonStoppedCleanly && Boolean(scratchAudit?.matchesExpected) && contextClosed && browserClosed && rootRemoved && !shutdownError;
        if (evidenceDurable) {
            try { writeEvidence(); }
            catch (error) { process.stderr.write(`Could not update cleanup receipt: ${String(error)}\n`); receipt.passed = false; }
        }
        if (!receipt.passed) process.exitCode = 1;
    }
}

main().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
});
