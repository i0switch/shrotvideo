"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var commander_1 = require("commander");
var node_path_1 = require("node:path");
var promises_1 = require("node:fs/promises");
var node_os_1 = require("node:os");
var fluent_ffmpeg_1 = require("fluent-ffmpeg");
var ffmpeg_static_1 = require("ffmpeg-static");
if (ffmpeg_static_1.default) {
    fluent_ffmpeg_1.default.setFfmpegPath(ffmpeg_static_1.default);
}
var video_generator_js_1 = require("../tasks/video-generator.js");
function ensureDir(p) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, promises_1.default.mkdir(p, { recursive: true })];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
// Helper: download a video file using yt-dlp binary
function downloadVideo(pageUrl, destDir, cookiePath) {
    return __awaiter(this, void 0, void 0, function () {
        var safeName, outPath, bin, execFile;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, ensureDir(destDir)];
                case 1:
                    _a.sent();
                    safeName = pageUrl.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
                    outPath = node_path_1.default.join(destDir, "".concat(safeName, ".mp4"));
                    bin = node_path_1.default.join(process.cwd(), 'node_modules', 'ytdlp-nodejs', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
                    return [4 /*yield*/, Promise.resolve().then(function () { return require('node:child_process'); })];
                case 2:
                    execFile = (_a.sent()).execFile;
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            var args = [
                                pageUrl,
                                '-o',
                                outPath,
                                '-f',
                                'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                                '--merge-output-format',
                                'mp4',
                                '--no-playlist',
                                '--no-warnings'
                            ];
                            if (cookiePath) {
                                args.push('--cookies', cookiePath);
                            }
                            execFile(bin, args, { timeout: 180000 }, function (err) {
                                if (err)
                                    return reject(err);
                                resolve();
                            });
                        })];
                case 3:
                    _a.sent();
                    return [2 /*return*/, outPath];
            }
        });
    });
}
// Helper: capture X post screenshot using Playwright
function captureXPostScreenshot(postUrl, destPath) {
    return __awaiter(this, void 0, void 0, function () {
        var chromium, browser, context, page, article, e_1, err, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require('playwright'); })];
                case 1:
                    chromium = (_b.sent()).chromium;
                    return [4 /*yield*/, chromium.launch({ headless: true })];
                case 2:
                    browser = _b.sent();
                    return [4 /*yield*/, browser.newContext({ viewport: { width: 1200, height: 2000 } })];
                case 3:
                    context = _b.sent();
                    return [4 /*yield*/, context.newPage()];
                case 4:
                    page = _b.sent();
                    _b.label = 5;
                case 5:
                    _b.trys.push([5, 10, 15, 18]);
                    return [4 /*yield*/, page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })];
                case 6:
                    _b.sent();
                    // できるだけ描画が落ち着くまで待機
                    return [4 /*yield*/, page.waitForLoadState('networkidle', { timeout: 30000 }).catch(function () { })];
                case 7:
                    // できるだけ描画が落ち着くまで待機
                    _b.sent();
                    article = page.locator('article[role="article"]').first();
                    return [4 /*yield*/, article.waitFor({ state: 'visible', timeout: 30000 })];
                case 8:
                    _b.sent();
                    return [4 /*yield*/, article.screenshot({ path: destPath })];
                case 9:
                    _b.sent();
                    return [2 /*return*/, true];
                case 10:
                    e_1 = _b.sent();
                    err = e_1;
                    console.error('X screenshot failed:', err.message || String(e_1));
                    _b.label = 11;
                case 11:
                    _b.trys.push([11, 13, , 14]);
                    return [4 /*yield*/, page.screenshot({ path: destPath, fullPage: true })];
                case 12:
                    _b.sent();
                    return [2 /*return*/, true];
                case 13:
                    _a = _b.sent();
                    return [3 /*break*/, 14];
                case 14: return [2 /*return*/, false];
                case 15: return [4 /*yield*/, context.close()];
                case 16:
                    _b.sent();
                    return [4 /*yield*/, browser.close()];
                case 17:
                    _b.sent();
                    return [7 /*endfinally*/];
                case 18: return [2 /*return*/];
            }
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var program, options, platform, url, cookies, tmpRoot, testData, outDir, baseSettings, id, settings, ssPath, ok, screenshotToUse, out, downloaded, out, e_2, err;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    program = new commander_1.Command();
                    program
                        .requiredOption('-p, --platform <type>', 'Platform (youtube, tiktok, x)')
                        .requiredOption('-u, --url <url>', 'URL of the video or post')
                        .option('-c, --cookies <path>', 'Path to a cookies file');
                    program.parse(process.argv);
                    options = program.opts();
                    platform = options.platform, url = options.url, cookies = options.cookies;
                    tmpRoot = node_path_1.default.join(node_os_1.default.tmpdir(), 'svt_runs');
                    testData = node_path_1.default.join(tmpRoot, 'data');
                    outDir = node_path_1.default.join(tmpRoot, 'out');
                    return [4 /*yield*/, ensureDir(testData)];
                case 1:
                    _b.sent();
                    return [4 /*yield*/, ensureDir(outDir)];
                case 2:
                    _b.sent();
                    // Generate dummy background and bgm
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            (0, fluent_ffmpeg_1.default)()
                                .input('color=c=black:s=1080x1920:d=10')
                                .inputOptions(['-f', 'lavfi'])
                                .outputOptions(['-pix_fmt', 'yuv420p'])
                                .on('end', function () { return resolve(); })
                                .on('error', function (err) { return reject(err); })
                                .save(node_path_1.default.join(testData, 'background.mp4'));
                        })];
                case 3:
                    // Generate dummy background and bgm
                    _b.sent();
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            (0, fluent_ffmpeg_1.default)()
                                .input('sine=frequency=800:duration=10')
                                .inputOptions(['-f', 'lavfi'])
                                .outputOptions(['-ac', '2', '-ar', '44100'])
                                .on('end', function () { return resolve(); })
                                .on('error', function (err) { return reject(err); })
                                .save(node_path_1.default.join(testData, 'bgm.wav'));
                        })];
                case 4:
                    _b.sent();
                    baseSettings = {
                        general: { outputPath: outDir },
                        platforms: {
                            x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
                            tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
                            youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
                        },
                        render: {
                            resolution: { width: 1080, height: 1920 },
                            durationSec: 10,
                            bgmPath: node_path_1.default.join(testData, 'bgm.wav'),
                            backgroundVideoPath: node_path_1.default.join(testData, 'background.mp4'),
                            captions: { top: 'AUTO_TOP', bottom: 'AUTO_BOTTOM' },
                            scale: 0.8,
                            teleTextBg: '#000000',
                            qualityPreset: 'standard',
                            overlayPosition: 'center',
                            topCaptionHeight: 120,
                            bottomCaptionHeight: 160,
                            captionBgOpacity: 1,
                        },
                    };
                    _b.label = 5;
                case 5:
                    _b.trys.push([5, 12, , 13]);
                    id = ((_a = url.split('/').pop()) === null || _a === void 0 ? void 0 : _a.split('?')[0]) || '';
                    settings = __assign(__assign({}, baseSettings), { render: __assign(__assign({}, baseSettings.render), { captions: { top: platform, bottom: id } }) });
                    if (!(platform === 'x')) return [3 /*break*/, 8];
                    ssPath = node_path_1.default.join(testData, "xshot-".concat(Date.now(), ".png"));
                    return [4 /*yield*/, captureXPostScreenshot(url, ssPath)];
                case 6:
                    ok = _b.sent();
                    screenshotToUse = ok ? ssPath : node_path_1.default.join(testData, 'screenshot.png');
                    return [4 /*yield*/, (0, video_generator_js_1.generateVideo)(screenshotToUse, settings)];
                case 7:
                    out = _b.sent();
                    console.log('Output:', out);
                    return [3 /*break*/, 11];
                case 8: return [4 /*yield*/, downloadVideo(url, node_path_1.default.join(tmpRoot, 'downloads'), cookies)];
                case 9:
                    downloaded = _b.sent();
                    return [4 /*yield*/, (0, video_generator_js_1.generateVideo)('', settings, downloaded)];
                case 10:
                    out = _b.sent();
                    console.log('Output:', out);
                    _b.label = 11;
                case 11: return [3 /*break*/, 13];
                case 12:
                    e_2 = _b.sent();
                    err = e_2;
                    console.error('Failed to generate for URL:', url, '\n', err.message || String(e_2));
                    return [3 /*break*/, 13];
                case 13: return [2 /*return*/];
            }
        });
    });
}
main().catch(function (e) {
    console.error(e);
    process.exit(1);
});
