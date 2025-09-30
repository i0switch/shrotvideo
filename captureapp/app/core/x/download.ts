import { BrowserContext, Page, Response, Route } from 'playwright';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { createLogger } from '@core/logging/logger';
import { ensureDir } from '@core/utils/paths';
import { getFfmpegCommand } from '@core/media/ffmpeg';

const logger = createLogger('download');
type HeaderMap = Record<string, string>;

const bearerCache = new WeakMap<BrowserContext, string>();

function normalizeHeaderMap(headers: HeaderMap): HeaderMap {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key]) => key && !key.startsWith(':'))
      .map(([key, value]) => [key.toLowerCase(), value])
  );
}

function buildCandidateHeaders(base?: HeaderMap): HeaderMap {
  const headers: HeaderMap = {
    accept: '*/*',
    referer: 'https://x.com/',
    origin: 'https://x.com',
    'user-agent':
      base?.['user-agent'] ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
  };

  if (base?.authorization) {
    headers.authorization = base.authorization;
  }
  if (base?.cookie) {
    headers.cookie = base.cookie;
  }
  if (base?.['x-csrf-token']) {
    headers['x-csrf-token'] = base['x-csrf-token'];
  }
  if (base?.['x-twitter-auth-type']) {
    headers['x-twitter-auth-type'] = base['x-twitter-auth-type'];
  }
  if (base?.['x-twitter-active-user']) {
    headers['x-twitter-active-user'] = base['x-twitter-active-user'];
  }
  if (base?.['x-twitter-client-language']) {
    headers['x-twitter-client-language'] = base['x-twitter-client-language'];
  }

  return headers;
}

export interface DownloadResult {
  filePath: string;
  sourceUrl: string;
}

export interface VideoCandidate {
  url: string;
  headers?: HeaderMap;
}

export async function collectVideoUrl(
  page: Page,
  tweetId?: string,
  waitMs = 15_000
): Promise<VideoCandidate | undefined> {
  const responseUrls = new Set<string>();
  const headerStore = new Map<string, HeaderMap>();
  const playbackStore = new Map<string, VideoCandidate>();
  let lastAuthHeader: string | undefined;
  let lastGuestToken: string | undefined;
  let segmentHeaderSamples = 0;

  const videoRoute = async (route: Route) => {
    const request = route.request();
    const fullUrl = request.url();
    const normalized = stripQuery(fullUrl);
    if (!fullUrl.includes('video.twimg.com')) {
      await route.continue();
      return;
    }

    try {
      logger.info('Intercepted video request', { url: normalized });
      const [allHeaders, baseHeaders] = await Promise.all([
        request
          .allHeaders()
          .catch(() => ({} as HeaderMap)),
        Promise.resolve()
          .then(() => request.headers())
          .then((headers) => headers as HeaderMap)
          .catch(() => ({} as HeaderMap))
      ]);

      const headerMap = normalizeHeaderMap({
        ...baseHeaders,
        ...allHeaders
      });

      if (headerMap.authorization) {
        const sanitized = sanitizeBearerToken(headerMap.authorization);
        if (sanitized) {
          headerMap.authorization = sanitized;
          lastAuthHeader = sanitized;
        }
      }
      if (headerMap['x-guest-token']) {
        lastGuestToken = headerMap['x-guest-token'];
      }

      headerStore.set(fullUrl, headerMap);
      headerStore.set(normalized, headerMap);

      if (normalized.endsWith('.m4s') && segmentHeaderSamples < 5) {
        const headerPreview: Record<string, string> = {};
        const previewKeys = ['range', 'accept', 'user-agent', 'referer', 'authorization'];
        for (const key of previewKeys) {
          const value = headerMap[key];
          if (typeof value === 'string' && value.length > 0) {
            headerPreview[key] = key === 'authorization' ? `${value.slice(0, 10)}...` : value;
          }
        }
        if (headerMap.cookie) {
          headerPreview.cookie = '[omitted]';
        }
        logger.info('Captured segment request headers', {
          url: normalized,
          headerPreview
        });
        segmentHeaderSamples += 1;
      }

      if (normalized.endsWith('.m3u8')) {
        logger.info('Intercepted playlist request', { url: fullUrl });
      }

      if (normalized.endsWith('playlist.m3u8')) {
        const headerPreview: Record<string, string> = {};
        const previewKeys = [
          'accept',
          'range',
          'user-agent',
          'sec-fetch-mode',
          'sec-fetch-site',
          'sec-fetch-dest',
          'accept-encoding',
          'referer'
        ];
        for (const key of previewKeys) {
          const value = headerMap[key];
          if (typeof value === 'string' && value.length > 0) {
            headerPreview[key] = value;
          }
        }
        if (headerMap.cookie) {
          headerPreview.cookie = '[omitted]';
        }
        if (headerMap.authorization) {
          headerPreview.authorization = `${headerMap.authorization.slice(0, 10)}...`;
        }
        logger.info('Captured playlist request headers', {
          url: normalized,
          headerKeys: Object.keys(headerMap),
          headerPreview
        });
      }
    } catch (error) {
      logger.warn('Failed to capture request headers for video resource', {
        url: fullUrl,
        message: error instanceof Error ? error.message : String(error)
      });
    }

    await route.continue();
  };

  const context = page.context();
  await context.route('https://video.twimg.com/**', videoRoute);
  logger.info('Registered video route interceptor');

  const handler = (response: Response) => {
    const fullUrl = response.url();
    if (fullUrl.includes('video.twimg.com') || fullUrl.match(/\.m3u8($|\?)/)) {
      if (fullUrl.includes('playlist.m3u8')) {
        logger.info('Observed playlist response', { url: fullUrl });
      }
      responseUrls.add(fullUrl);
      const normalized = stripQuery(fullUrl);
      responseUrls.add(normalized);
      void (async () => {
        const [allHeaders, baseRequestHeaders] = await Promise.all([
          response
            .request()
            .allHeaders()
            .catch(() => ({} as HeaderMap)),
          Promise.resolve()
            .then(() => response.request().headers())
            .then((headers) => headers as HeaderMap)
            .catch(() => ({} as HeaderMap))
        ]);

        const headerMap = normalizeHeaderMap({
          ...baseRequestHeaders,
          ...allHeaders
        });
          if (headerMap.authorization) {
            const sanitized = sanitizeBearerToken(headerMap.authorization);
            if (sanitized) {
              headerMap.authorization = sanitized;
              lastAuthHeader = sanitized;
            }
          }
          if (headerMap['x-guest-token']) {
            lastGuestToken = headerMap['x-guest-token'];
          }
          headerStore.set(fullUrl, headerMap);
          headerStore.set(normalized, headerMap);
          if (normalized.endsWith('.m4s')) {
            const playlists = derivePlaylistUrls(fullUrl);
            for (const playlist of playlists) {
              responseUrls.add(playlist);
              headerStore.set(playlist, headerMap);
            }
          } else if (normalized.endsWith('playlist.m3u8')) {
            const headerPreview: Record<string, string> = {};
            const previewKeys = [
              'accept',
              'range',
              'user-agent',
              'sec-fetch-mode',
              'sec-fetch-site',
              'sec-fetch-dest',
              'accept-encoding',
              'referer'
            ];
            for (const key of previewKeys) {
              const value = headerMap[key];
              if (typeof value === 'string' && value.length > 0) {
                headerPreview[key] = value;
              }
            }
            if (headerMap.cookie) {
              headerPreview.cookie = '[omitted]';
            }
            if (headerMap.authorization) {
              headerPreview.authorization = `${headerMap.authorization.slice(0, 10)}...`;
            }
            logger.info('Captured playlist request headers', {
              url: normalized,
              headerKeys: Object.keys(headerMap),
              headerPreview
            });
          }
  })().catch(() => undefined);
    } else if (fullUrl.includes('/videos/tweet/config/')) {
      void Promise.all([
        response
          .request()
          .allHeaders()
          .then((headers) => normalizeHeaderMap(headers as HeaderMap))
          .catch(() => ({} as HeaderMap)),
        response
          .json()
          .then((json) => json as { track?: { playbackUrl?: string } })
          .catch(() => undefined)
      ])
        .then(([headers, data]) => {
          if (!data?.track?.playbackUrl) {
            return;
          }
          const idFromUrl = extractTweetIdFromConfigUrl(fullUrl);
          if (!idFromUrl) {
            return;
          }

          const candidateHeaders = buildCandidateHeaders(headers);

          playbackStore.set(idFromUrl, {
            url: data.track.playbackUrl,
            headers: candidateHeaders
          });
        })
        .catch(() => undefined);
    } else if (fullUrl.includes('/i/api/graphql/')) {
      const match = fullUrl.match(/\/i\/api\/graphql\/(\w+)/);
      if (match?.[1]) {
        logger.info('Observed GraphQL response', { operation: match[1] });
      } else {
        logger.info('Observed GraphQL response', { url: fullUrl });
      }
      void Promise.all([
        response
          .request()
          .allHeaders()
          .then((headers) => normalizeHeaderMap(headers as HeaderMap))
          .catch(() => ({} as HeaderMap)),
        response
          .json()
          .catch(() => undefined)
      ])
        .then(([headers, data]) => {
          if (!data) {
            return;
          }
          const playbackCandidates = extractPlaybackFromGraphql(data);
          if (playbackCandidates.length === 0) {
            return;
          }
          const candidateHeaders = buildCandidateHeaders(headers);
          const bestByTweet = new Map<string, GraphqlPlaybackCandidate>();
          for (const candidate of playbackCandidates) {
            if (!candidate.url || !candidate.tweetId) {
              continue;
            }
            const existing = bestByTweet.get(candidate.tweetId);
            const currentScore = candidate.bitrate ?? (candidate.contentType?.includes('mp4') ? 1 : 0);
            const existingScore = existing
              ? existing.bitrate ?? (existing.contentType?.includes('mp4') ? 1 : 0)
              : -1;
            if (!existing || currentScore > existingScore) {
              bestByTweet.set(candidate.tweetId, candidate);
            }
          }

          for (const [id, candidate] of bestByTweet.entries()) {
            playbackStore.set(id, {
              url: candidate.url,
              headers: candidateHeaders
            });
            logger.info('Captured playback from GraphQL response', {
              tweetId: id,
              source: candidate.url,
              bitrate: candidate.bitrate ?? null,
              contentType: candidate.contentType ?? null
            });
          }
        })
        .catch(() => undefined);
    }
  };

  page.on('response', handler);

  try {
    await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>('article video');
      if (video) {
        video.muted = true;
        video.loop = false;
        if (video.paused) {
          void video.play().catch(() => undefined);
        }
      }
    });
  } catch {
    // ignore
  }

  await page.waitForTimeout(waitMs);

  try {
    const resourceUrls = (await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => (entry as any).name as string)
        .filter(
          (name) =>
            typeof name === 'string' &&
            (name.includes('video.twimg.com') || /\.m3u8($|\?)/.test(name) || name.endsWith('.mp4'))
        )
    )) as string[];
    resourceUrls.forEach((url) => {
      responseUrls.add(url);
      responseUrls.add(stripQuery(url));
    });
  } catch {
    // ignore
  }

  try {
    const currentSrc = await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>('video');
      return video?.currentSrc ?? video?.src ?? undefined;
    });
    if (currentSrc) {
      responseUrls.add(currentSrc);
      responseUrls.add(stripQuery(currentSrc));
    }
  } catch {
    // ignore
  }

  let fetchedPlaybackCandidate: VideoCandidate | undefined;
  if (tweetId && !playbackStore.has(tweetId)) {
    fetchedPlaybackCandidate = await fetchPlaybackViaPage(page, tweetId);
    if (fetchedPlaybackCandidate) {
      playbackStore.set(tweetId, fetchedPlaybackCandidate);
    } else {
      await page.waitForTimeout(200);
    }
  }

  page.off('response', handler);
  await context.unroute('https://video.twimg.com/**', videoRoute).catch(() => undefined);
  logger.info('Unregistered video route interceptor');

  const mediaUrls = Array.from(responseUrls).filter((url) => url.includes('video.twimg.com'));
  logger.info('Collected media URLs', {
    tweetId,
    total: mediaUrls.length,
    samples: mediaUrls.slice(0, 5)
  });

  const prioritized = Array.from(responseUrls)
    .filter((url) => !url.includes('/aud/'))
    .sort((a, b) => scoreUrl(b) - scoreUrl(a));

  const best = prioritized[0];
  let networkCandidate: VideoCandidate | undefined;
  if (best) {
    const storedHeaders = headerStore.get(best);
    const mergedHeaders = storedHeaders ? { ...storedHeaders } : {};
    if (lastAuthHeader && !mergedHeaders.authorization) {
      mergedHeaders.authorization = lastAuthHeader;
    }
    if (lastGuestToken && !mergedHeaders['x-guest-token']) {
      mergedHeaders['x-guest-token'] = lastGuestToken;
    }
    networkCandidate = {
      url: best,
      headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined
    };
  }

  if (networkCandidate) {
    const headerPreview: Record<string, string> = {};
    if (networkCandidate.headers) {
      const previewKeys = ['accept', 'range', 'user-agent', 'authorization', 'cookie'];
      for (const key of previewKeys) {
        const value = networkCandidate.headers[key];
        if (!value) {
          continue;
        }
        headerPreview[key] = key === 'cookie' ? '[omitted]' : value.slice(0, 60);
      }
    }
    logger.info('Network candidate headers', {
      source: networkCandidate.url,
      hasAuth: Boolean(networkCandidate.headers?.authorization),
      hasCookie: Boolean(networkCandidate.headers?.cookie),
      headerPreview
    });
  }

  if (tweetId) {
    const playbackCandidate = playbackStore.get(tweetId) ?? fetchedPlaybackCandidate;
    if (playbackCandidate) {
      if (lastAuthHeader && !playbackCandidate.headers?.authorization) {
        playbackCandidate.headers = {
          ...(playbackCandidate.headers ?? {}),
          authorization: lastAuthHeader
        };
      }
      if (lastGuestToken && !playbackCandidate.headers?.['x-guest-token']) {
        playbackCandidate.headers = {
          ...(playbackCandidate.headers ?? {}),
          'x-guest-token': lastGuestToken
        };
      }
      logger.info('Using playback config candidate', { source: playbackCandidate.url });
      return playbackCandidate;
    }
  }

  const nextDataCandidate = await extractVideoFromNextData(page, tweetId);
  if (nextDataCandidate) {
    if (lastAuthHeader) {
      nextDataCandidate.headers = {
        ...(nextDataCandidate.headers ?? {}),
        authorization: lastAuthHeader
      };
    }
    if (lastGuestToken) {
      nextDataCandidate.headers = {
        ...(nextDataCandidate.headers ?? {}),
        'x-guest-token': lastGuestToken
      };
    }
    return nextDataCandidate;
  }

  if (networkCandidate) {
    logger.info('Detected candidate video URL', { source: networkCandidate.url });
    return networkCandidate;
  }

  return networkCandidate;
}

function stripQuery(url: string): string {
  const idx = url.indexOf('?');
  return idx === -1 ? url : url.slice(0, idx);
}

function derivePlaylistUrls(originalUrl: string): string[] {
  const normalized = stripQuery(originalUrl);
  if (!normalized.endsWith('.m4s')) {
    return [];
  }

  try {
    const original = new URL(originalUrl);
    const rawSegments = original.pathname.split('/').filter(Boolean);
    if (rawSegments.length < 2) {
      return [];
    }

    const pathVariants: string[][] = [];

    // Variant 1: replace segment filename with playlist.m3u8 keeping full structure
    const sameStructure = [...rawSegments];
    sameStructure[sameStructure.length - 1] = 'playlist.m3u8';
    pathVariants.push(sameStructure);

    const vidIndex = rawSegments.indexOf('vid');
    const resolution = rawSegments[rawSegments.length - 2];
    const codec = rawSegments[vidIndex + 1];

    if (vidIndex !== -1 && resolution) {
      const prefix = rawSegments.slice(0, vidIndex); // e.g. ext_tw_video/<id>/pu
      const suffix = rawSegments.slice(vidIndex); // starts with ['vid', ...]

      // Variant 2: drop bitrate folders but keep codec
      if (codec) {
        pathVariants.push([...prefix, 'vid', codec, resolution, 'playlist.m3u8']);
      }

      // Variant 3: drop codec and bitrate
      pathVariants.push([...prefix, 'vid', resolution, 'playlist.m3u8']);

      // Variant 4: pl folder convention (older derivation)
      pathVariants.push([...prefix, 'pl', resolution, 'playlist.m3u8']);
    }

    const baseParams = new URLSearchParams(original.search);
    const tagExisting = baseParams.get('tag');
    const containerExisting = baseParams.get('container');

    const tagOptions = tagExisting !== null ? [tagExisting, null] : [null, '12', '11', '10'];
    const containerOptions =
      containerExisting !== null ? [containerExisting, null] : [null, 'fmp4', 'mp4'];
    const originallyHadBoth = tagExisting !== null && containerExisting !== null;

    const results = new Set<string>();

    for (const pathSegments of pathVariants) {
      if (!pathSegments[pathSegments.length - 1]?.endsWith('.m3u8')) {
        continue;
      }

      for (const tag of tagOptions) {
        for (const container of containerOptions) {
          if (tag && container && !originallyHadBoth) {
            continue;
          }
          const variant = new URL(original.origin);
          variant.pathname = `/${pathSegments.join('/')}`;
          const params = new URLSearchParams(baseParams.toString());

          if (tag) {
            params.set('tag', tag);
          } else {
            params.delete('tag');
          }

          if (container) {
            params.set('container', container);
          } else {
            params.delete('container');
          }

          const queryString = params.toString();
          variant.search = queryString ? `?${queryString}` : '';

          results.add(variant.toString());
        }
      }
    }

    return Array.from(results);
  } catch {
    return [];
  }
}

function ensureHlsAccept(headers: HeaderMap): HeaderMap {
  const next = { ...headers };
  // Prefer HLS MIME types
  next.accept = next.accept || 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*';
  return next;
}

function expandPlaylistCandidates(originalUrl: string): string[] {
  const results = new Set<string>();
  results.add(originalUrl);

  try {
    const parsed = new URL(originalUrl);
    if (!parsed.pathname.endsWith('playlist.m3u8')) {
      return Array.from(results);
    }

    const dummy = new URL(parsed.toString());
    dummy.pathname = dummy.pathname.replace(/playlist\.m3u8$/, 'segment.m4s');
    const derived = derivePlaylistUrls(dummy.toString());
    for (const candidate of derived) {
      results.add(candidate);
    }
    // add variants toggling tag/container flags commonly seen
    const qs = new URLSearchParams(parsed.search);
    const bases = new Set<string>();
    bases.add(parsed.toString());
    // Try with/without tag and container
    const tagValues = [qs.get('tag'), '12', '11', null].filter(
      (v, i, arr) => (v !== null ? true : i === arr.length - 1)
    ) as (string | null)[];
    const containerValues = [qs.get('container'), 'fmp4', 'mp4', null].filter(
      (v, i, arr) => (v !== null ? true : i === arr.length - 1)
    ) as (string | null)[];
    const vcValues = [qs.get('v'), 'cfc', null] as (string | null)[];

    for (const tag of tagValues) {
      for (const container of containerValues) {
        for (const v of vcValues) {
          const u = new URL(parsed.toString());
          const q = new URLSearchParams(u.search);
          if (tag) q.set('tag', tag); else q.delete('tag');
          if (container) q.set('container', container); else q.delete('container');
          if (v) q.set('v', v); else q.delete('v');
          u.search = q.toString() ? `?${q.toString()}` : '';
          results.add(u.toString());
        }
      }
    }
  } catch {
    // ignore derivation errors
  }

  return Array.from(results);
}

async function safeUnlink(filePath: string): Promise<void> {
  await fs.promises.unlink(filePath).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && (error as any).code !== 'ENOENT') {
      throw error;
    }
  });
}

function stripAuthorizationHeaders(headers: HeaderMap): HeaderMap {
  const next = { ...headers };
  delete next.authorization;
  delete next['x-twitter-auth-type'];
  return next;
}

function shouldRetryWithoutAuthStatus(status?: number): boolean {
  if (typeof status !== 'number') {
    return false;
  }
  return status === 401 || status === 403 || status === 404;
}


function scoreUrl(url: string): number {
  const hasQuery = url.includes('?');

  if (/\.mp4($|\?)/.test(url)) {
    return hasQuery ? 205 : 200;
  }
  if (/playlist\.m3u8($|\?)/.test(url)) {
    let score = hasQuery ? 195 : 185;
    if (/tag=\d+/.test(url)) {
      score += 6;
    }
    if (/container=(mp4|fmp4)/.test(url)) {
      score -= 4;
    }
    return score;
  }
  if (/\.m3u8($|\?)/.test(url)) {
    return hasQuery ? 180 : 170;
  }
  if (/\.m4s($|\?)/.test(url)) {
    return hasQuery ? 15 : 10;
  }
  if (url.includes('/vid/')) {
    return 60;
  }
  return hasQuery ? 5 : 0;
}

function isSegmentUrl(url: string): boolean {
  return url.endsWith('.m4s');
}

async function downloadViaHttp(sourceUrl: string, filePath: string, headers: HeaderMap) {
  const response = await fetch(sourceUrl, {
    headers
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
  }

  const fileStream = fs.createWriteStream(filePath);
  const readable = Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);
  await pipeline(readable, fileStream);
}

async function downloadViaFfmpeg(sourceUrl: string, filePath: string, headers: HeaderMap) {
  const ffmpeg = getFfmpegCommand();
  await new Promise<void>((resolve, reject) => {
    const command = ffmpeg(sourceUrl);
    const headerLines = Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\r\n');
    if (headerLines) {
      command.addInputOption('-headers', `${headerLines}\r\n`);
    }
    if (headers['user-agent']) {
      command.addInputOption('-user_agent', headers['user-agent']);
    }
    // HLS friendly demux options
    command.addInputOption('-protocol_whitelist', 'file,http,https,tcp,tls,crypto');
    command
      .outputOptions(['-c:v libx264', '-c:a aac', '-bsf:a aac_adtstoasc', '-movflags +faststart'])
      .on('error', (error: Error) => reject(error))
      .on('end', () => resolve())
      .save(filePath);
  });
}

function shouldRetryWithoutAuth(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (!message) {
    return false;
  }
  return /404/.test(message) || /not found/i.test(message);
}

async function buildAuthenticatedHeaders(page: Page): Promise<HeaderMap> {
  const context = page.context();
  const cookies = await context.cookies(['https://x.com', 'https://video.twimg.com']);
  logger.debug('Collected cookies for authenticated headers', {
    count: cookies.length,
    names: cookies.map((cookie) => cookie.name).slice(0, 10)
  });
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  const csrf = cookies.find((cookie) => cookie.name === 'ct0')?.value;
  const guestToken = cookies.find((cookie) => cookie.name === 'gt' || cookie.name === 'guest_token')?.value;

  const headers: HeaderMap = {
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    accept: 'application/json, text/plain, */*',
    referer: 'https://x.com/',
    origin: 'https://x.com',
    'accept-language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  if (csrf) {
    headers['x-csrf-token'] = csrf;
  }
  if (guestToken) {
    headers['x-guest-token'] = guestToken;
  }

  const bearer = await resolveBearerToken(page);
  if (bearer) {
    headers.authorization = bearer;
    headers['x-twitter-auth-type'] = headers['x-twitter-auth-type'] ?? 'OAuth2Session';
    headers['x-twitter-active-user'] = headers['x-twitter-active-user'] ?? 'yes';
    headers['x-twitter-client-language'] = headers['x-twitter-client-language'] ?? 'ja';
  }

  return headers;
}

type GraphqlPlaybackCandidate = {
  url: string;
  tweetId?: string;
  bitrate?: number;
  contentType?: string;
};

function extractPlaybackFromGraphql(data: unknown): GraphqlPlaybackCandidate[] {
  const results: GraphqlPlaybackCandidate[] = [];
  const seen = new Set<string>();

  const visit = (node: any, contextTweetId?: string) => {
    if (!node) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((value) => visit(value, contextTweetId));
      return;
    }
    if (typeof node !== 'object') {
      return;
    }

    const possibleTweetId =
      (typeof node.rest_id === 'string' && node.rest_id) ||
      (typeof node.tweet_id === 'string' && node.tweet_id) ||
      (typeof node.id_str === 'string' && node.id_str) ||
      (typeof node.id === 'string' && /^\d+$/.test(node.id) ? node.id : undefined) ||
      contextTweetId;

    const registerCandidate = (url: string, bitrate?: number, contentType?: string) => {
      const key = `${possibleTweetId ?? 'unknown'}|${url}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      results.push({ url, tweetId: possibleTweetId, bitrate, contentType });
    };

    if (typeof node.playbackUrl === 'string') {
      registerCandidate(node.playbackUrl as string);
    }
    if (node.track && typeof node.track.playbackUrl === 'string') {
      registerCandidate(node.track.playbackUrl as string);
    }

    const variantSources: any[] = [];
    if (Array.isArray(node.variants)) {
      variantSources.push(node.variants);
    }
    if (Array.isArray(node.video_info?.variants)) {
      variantSources.push(node.video_info.variants);
    }

    for (const variants of variantSources) {
      for (const variant of variants) {
        if (!variant || typeof variant.url !== 'string') {
          continue;
        }
        const bitrate =
          typeof variant.bitrate === 'number'
            ? variant.bitrate
            : typeof variant.bitrate === 'string'
            ? Number.parseInt(variant.bitrate, 10)
            : undefined;
        const contentType = typeof variant.content_type === 'string' ? variant.content_type : undefined;
        registerCandidate(variant.url, bitrate, contentType);
      }
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        visit(value, possibleTweetId);
      }
    }
  };

  visit(data);

  return results;
}

export async function downloadVideo(
  sourceUrl: string,
  outDir: string,
  fileName: string,
  page: Page,
  providedHeaders?: HeaderMap
): Promise<DownloadResult> {
  ensureDir(outDir);
  const filePath = path.join(outDir, fileName);
  const baseHeaders = await buildAuthenticatedHeaders(page);
  const normalizedProvided = providedHeaders ? normalizeHeaderMap(providedHeaders) : undefined;
  const combinedHeaders = normalizedProvided
    ? { ...baseHeaders, ...normalizedProvided }
    : { ...baseHeaders };

  logger.info('Downloading video', {
    sourceUrl,
    filePath,
    hasCookie: Boolean(combinedHeaders.cookie),
    hasAuth: Boolean(combinedHeaders.authorization),
    authPreview: combinedHeaders.authorization
      ? `${combinedHeaders.authorization.slice(0, 40)}...`
      : undefined
  });

  if (sourceUrl.includes('.m3u8')) {
    const playlistCandidates = expandPlaylistCandidates(sourceUrl);
    let lastError: unknown;

    for (const playlistUrl of playlistCandidates) {
      let attemptHeaders = ensureHlsAccept({ ...combinedHeaders });
      logger.info('Attempting playlist candidate', { playlistUrl });
      try {
        let probeResponse = await page.context().request.get(playlistUrl, {
          headers: attemptHeaders
        });

        if (!probeResponse.ok()) {
          const snippet = (await probeResponse.text().catch(() => '')).slice(0, 200);
          logger.warn('Playlist probe failed', {
            sourceUrl: playlistUrl,
            status: probeResponse.status(),
            ok: probeResponse.ok(),
            bodySnippet: snippet
          });

          if (attemptHeaders.authorization && shouldRetryWithoutAuthStatus(probeResponse.status())) {
            const strippedHeaders = ensureHlsAccept(stripAuthorizationHeaders(attemptHeaders));
            probeResponse = await page.context().request.get(playlistUrl, {
              headers: strippedHeaders
            });

            if (!probeResponse.ok()) {
              const retrySnippet = (await probeResponse.text().catch(() => '')).slice(0, 200);
              logger.warn('Playlist probe failed after stripping authorization', {
                sourceUrl: playlistUrl,
                status: probeResponse.status(),
                ok: probeResponse.ok(),
                bodySnippet: retrySnippet
              });
              throw new Error(
                `Playlist probe failed for ${playlistUrl} with status ${probeResponse.status()}`
              );
            }

            attemptHeaders = strippedHeaders;
          } else {
            throw new Error(
              `Playlist probe failed for ${playlistUrl} with status ${probeResponse.status()}`
            );
          }
        } else {
          logger.info('Playlist probe succeeded', {
            sourceUrl: playlistUrl,
            status: probeResponse.status(),
            contentLength: probeResponse.headers()['content-length'] ?? null
          });
        }

        await safeUnlink(filePath);
        try {
          await downloadViaFfmpeg(playlistUrl, filePath, attemptHeaders);
          logger.info('Playlist download succeeded', { sourceUrl: playlistUrl });
          return { filePath, sourceUrl: playlistUrl };
        } catch (error) {
          if (attemptHeaders.authorization && shouldRetryWithoutAuth(error)) {
            const strippedHeaders = ensureHlsAccept(stripAuthorizationHeaders(attemptHeaders));
            logger.warn('Playlist download failed with auth, retrying without authorization header', {
              sourceUrl: playlistUrl,
              message: error instanceof Error ? error.message : String(error)
            });
            await safeUnlink(filePath);
            await downloadViaFfmpeg(playlistUrl, filePath, strippedHeaders);
            logger.info('Playlist download succeeded without authorization header', {
              sourceUrl: playlistUrl
            });
            return { filePath, sourceUrl: playlistUrl };
          }
          throw error;
        }
      } catch (error) {
        lastError = error;
        logger.warn('Playlist candidate failed', {
          playlistUrl,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error('All playlist candidates failed');
  } else if (sourceUrl.endsWith('.mp4') || sourceUrl.includes('.mp4?')) {
    await downloadViaHttp(sourceUrl, filePath, combinedHeaders);
  } else if (sourceUrl.endsWith('.m4s')) {
    const playlistUrls = derivePlaylistUrls(sourceUrl);
    for (const playlistUrl of playlistUrls) {
      let attemptHeaders = { ...combinedHeaders };
      try {
        let probeResponse = await page.context().request.get(playlistUrl, {
          headers: attemptHeaders
        });
        logger.info('Probed derived playlist', {
          playlistUrl,
          status: probeResponse.status(),
          ok: probeResponse.ok()
        });
        if (!probeResponse.ok()) {
          if (attemptHeaders.authorization && shouldRetryWithoutAuthStatus(probeResponse.status())) {
            const strippedHeaders = stripAuthorizationHeaders(attemptHeaders);
            probeResponse = await page.context().request.get(playlistUrl, {
              headers: strippedHeaders
            });
            logger.info('Probed derived playlist after stripping authorization', {
              playlistUrl,
              status: probeResponse.status(),
              ok: probeResponse.ok()
            });
            if (!probeResponse.ok()) {
              throw new Error(`Playlist probe failed with status ${probeResponse.status()}`);
            }
            attemptHeaders = strippedHeaders;
          } else {
            throw new Error(`Playlist probe failed with status ${probeResponse.status()}`);
          }
        }
        logger.info('Attempting playlist download for segment source', {
          sourceUrl,
          playlistUrl
        });
        await safeUnlink(filePath);
        try {
          await downloadViaFfmpeg(playlistUrl, filePath, attemptHeaders);
          return { filePath, sourceUrl: playlistUrl };
        } catch (error) {
          if (attemptHeaders.authorization && shouldRetryWithoutAuth(error)) {
            const strippedHeaders = stripAuthorizationHeaders(attemptHeaders);
            logger.warn(
              'Playlist download fallback failed with auth, retrying without authorization header',
              {
                sourceUrl,
                playlistUrl,
                message: error instanceof Error ? error.message : String(error)
              }
            );
            await safeUnlink(filePath);
            await downloadViaFfmpeg(playlistUrl, filePath, strippedHeaders);
            return { filePath, sourceUrl: playlistUrl };
          }
          throw error;
        }
      } catch (error) {
        logger.warn('Playlist download fallback failed, trying next variant', {
          sourceUrl,
          playlistUrl,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (playlistUrls.length > 0) {
      logger.warn('All derived playlist probes failed, reverting to raw segment download', {
        sourceUrl,
        variantsTried: playlistUrls.length
      });
    }
    const tempPath = `${filePath}.segment`;
    await downloadViaHttp(sourceUrl, tempPath, combinedHeaders);
    await convertSegmentToMp4(tempPath, filePath);
    await fs.promises.unlink(tempPath).catch(() => undefined);
  } else {
    await downloadViaHttp(sourceUrl, filePath, combinedHeaders);
  }

  return { filePath, sourceUrl };
}

async function convertSegmentToMp4(segmentPath: string, destination: string) {
  const ffmpeg = getFfmpegCommand();
  await new Promise<void>((resolve, reject) => {
    const command = ffmpeg(segmentPath)
      .outputOptions(['-c copy', '-movflags +faststart'])
      .on('error', (error: Error) => reject(error))
      .on('end', () => resolve())
      .save(destination);
  });
}

function extractTweetIdFromConfigUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const configIndex = segments.findIndex((segment) => segment === 'config');
    if (configIndex === -1 || configIndex + 1 >= segments.length) {
      return undefined;
    }
    const maybeId = segments[configIndex + 1];
    return maybeId.replace(/\.json$/, '');
  } catch {
    return undefined;
  }
}

async function fetchPlaybackViaPage(page: Page, tweetId: string): Promise<VideoCandidate | undefined> {
  const endpoint = `https://x.com/i/api/1.1/videos/tweet/config/${tweetId}.json`;

  try {
    const requestHeaders = await buildAuthenticatedHeaders(page);
    requestHeaders['x-twitter-auth-type'] = requestHeaders['x-twitter-auth-type'] ?? 'OAuth2Session';
    requestHeaders['x-twitter-active-user'] = requestHeaders['x-twitter-active-user'] ?? 'yes';

    const response = await page.context().request.get(endpoint, {
      headers: requestHeaders
    });

    if (response.ok()) {
      const data = (await response.json()) as { track?: { playbackUrl?: string } };
      const playbackUrl = data?.track?.playbackUrl;
      if (playbackUrl) {
        const candidateHeaders: HeaderMap = buildCandidateHeaders(requestHeaders);
        return {
          url: playbackUrl,
          headers: candidateHeaders
        };
      }
      logger.warn('Playback config missing URL (request API)', { tweetId });
    } else {
      const status = response.status();
      const text = await response.text();
      logger.warn('Playback config fetch via request failed', {
        tweetId,
        status,
        bodySnippet: text.slice(0, 200)
      });
    }
  } catch (error) {
    logger.warn('Playback config request error', {
      tweetId,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  try {
    const result = await page.evaluate(async (id) => {
      const findCookie = (name: string) => {
        const pattern = new RegExp(`${name}=([^;]+)`);
        const match = document.cookie.match(pattern);
        return match ? match[1] : undefined;
      };

      const storages = [localStorage, sessionStorage];
      const extractBearer = (): string | undefined => {
        for (const storage of storages) {
          for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (!key) {
              continue;
            }
            const rawValue = storage.getItem(key) ?? '';
            if (!rawValue) {
              continue;
            }
            if (rawValue.startsWith('Bearer ')) {
              return rawValue;
            }
            if (/AAAAA/.test(rawValue) || /AAAAAA/.test(rawValue)) {
              return rawValue;
            }
            try {
              const parsed = JSON.parse(rawValue);
              if (parsed && typeof parsed === 'object') {
                for (const value of Object.values(parsed)) {
                  if (typeof value === 'string' && value.startsWith('Bearer ')) {
                    return value;
                  }
                  if (typeof value === 'string' && /AAAAA/.test(value)) {
                    return value;
                  }
                }
              }
            } catch {
              // ignore JSON parse errors
            }
          }
        }
        return undefined;
      };

      try {
        const bearer = extractBearer();
        const csrf = findCookie('ct0');
        const headers: Record<string, string> = {
          accept: '*/*',
          referer: 'https://x.com/',
          origin: 'https://x.com',
          'user-agent': navigator.userAgent,
          'x-twitter-active-user': 'yes',
          'x-twitter-client-language': navigator.language || 'en-US'
        };

        if (csrf) {
          headers['x-csrf-token'] = csrf;
        }
        if (bearer) {
          headers.authorization = bearer;
          headers['x-twitter-auth-type'] = 'OAuth2Session';
        } else {
          headers['x-twitter-auth-type'] = 'OAuth2Client';
        }

        const response = await fetch(endpoint, {
          credentials: 'include',
          cache: 'no-cache',
          headers
        });
        const text = await response.text();
        return {
          ok: response.ok,
          status: response.status,
          body: text,
          bearer,
          csrf,
          hadBearer: Boolean(bearer)
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          body: String(error),
          bearer: '',
          csrf: undefined
        };
      }
    }, tweetId);

    if (!result?.ok) {
      logger.warn('Playback config fetch failed in page', {
        tweetId,
        status: result?.status,
        hadBearer: result?.hadBearer ?? false
      });
      return undefined;
    }

    let playbackUrl: string | undefined;
    try {
      const parsed = JSON.parse(result.body ?? '{}') as { track?: { playbackUrl?: string } };
      playbackUrl = parsed?.track?.playbackUrl;
    } catch (error) {
      logger.warn('Failed to parse playback config body', {
        tweetId,
        message: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }

    if (!playbackUrl) {
      logger.warn('Playback config missing URL', { tweetId });
      return undefined;
    }

    const candidateHeaders: HeaderMap = {
      accept: '*/*',
      referer: 'https://x.com/',
      origin: 'https://x.com',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
    };

    const bearer = typeof result.bearer === 'string' ? sanitizeBearerToken(result.bearer) : undefined;
    if (bearer) {
      candidateHeaders.authorization = bearer;
      candidateHeaders['x-twitter-auth-type'] = 'OAuth2Session';
    }
    if (typeof result.csrf === 'string' && result.csrf.length > 0) {
      candidateHeaders['x-csrf-token'] = result.csrf;
    }

    return { url: playbackUrl, headers: candidateHeaders };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Error fetching playback config via page', { tweetId, message });
    return undefined;
  }
}

function sanitizeBearerToken(raw?: string | null): string | undefined {
  if (!raw) {
    return undefined;
  }
  const token = raw.trim().replace(/^"|"$/g, '');
  if (!token) {
    return undefined;
  }
  if (token.startsWith('Bearer ')) {
    return token;
  }
  return `Bearer ${token}`;
}

async function resolveBearerToken(page: Page): Promise<string | undefined> {
  try {
    const context = page.context();
    const cached = bearerCache.get(context);
    if (cached) {
      return cached;
    }

    const storageToken = await page
      .evaluate(() => {
        const stores = [localStorage, sessionStorage];
        for (const storage of stores) {
          for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (!key) {
              continue;
            }
            const value = storage.getItem(key);
            if (typeof value === 'string' && value.includes('Bearer ')) {
              return value;
            }
          }
        }
        return undefined;
      })
      .catch(() => undefined);

    const sanitizedFromStorage = sanitizeBearerToken(storageToken);
    if (sanitizedFromStorage) {
      const isNew = !bearerCache.has(context);
      bearerCache.set(context, sanitizedFromStorage);
      if (isNew) {
        logger.info('Resolved bearer token from storage');
      }
      return sanitizedFromStorage;
    }

    const scriptUrls = (await page
      .evaluate(() => {
        return Array.from(document.querySelectorAll('script[src]'))
          .map((node) => node.getAttribute('src'))
          .filter((src) => typeof src === 'string' && /client-web/.test(src));
      })
      .catch(() => [])) as string[];

    for (const scriptUrl of scriptUrls) {
      try {
        const absoluteUrl = new URL(scriptUrl, page.url()).toString();
        const response = await page.context().request.get(absoluteUrl);
        if (!response.ok()) {
          continue;
        }
  const body = await response.text();
  const match = body.match(/Bearer [A-Za-z0-9%-]{20,}/);
        if (match?.[0]) {
          const sanitized = sanitizeBearerToken(match[0]);
          if (sanitized) {
            const isNew = !bearerCache.has(context);
            bearerCache.set(context, sanitized);
            if (isNew) {
              logger.info('Resolved bearer token from scripts');
            }
            return sanitized;
          }
        }
      } catch {
        // ignore fetch errors for individual scripts
      }
    }
  } catch {
    // ignore unexpected errors when resolving bearer token
  }

  return undefined;
}

async function extractVideoFromNextData(
  page: Page,
  tweetId?: string
): Promise<VideoCandidate | undefined> {
  try {
    const result = await page.evaluate((id) => {
      const script = document.querySelector('#__NEXT_DATA__');
      if (!script?.textContent) {
        return { url: null, tweetId: null, contentType: null, variantCount: 0 };
      }

      let parsed: any;
      try {
        parsed = JSON.parse(script.textContent);
      } catch {
        return { url: null, tweetId: null, contentType: null, variantCount: 0 };
      }

      type Variant = {
        url: string;
        bitrate?: number | null;
        contentType?: string | null;
        tweetId?: string;
      };

      const variants: Variant[] = [];

      const visit = (node: any, contextTweetId?: string) => {
        if (!node) {
          return;
        }
        if (Array.isArray(node)) {
          node.forEach((value) => visit(value, contextTweetId));
          return;
        }
        if (typeof node !== 'object') {
          return;
        }

        const possibleTweetId =
          (typeof node.rest_id === 'string' && node.rest_id) ||
          (typeof node.tweet_id === 'string' && node.tweet_id) ||
          (typeof node.id_str === 'string' && node.id_str) ||
          contextTweetId;

        const legacy =
          node.legacy ??
          node.tweet?.legacy ??
          node.itemContent?.tweet_results?.result?.legacy ??
          node.itemContent?.tweet_results?.result?.tweet?.legacy ??
          undefined;

        const mediaItems =
          legacy?.extended_entities?.media ?? legacy?.entities?.media ?? node.mediaDetails ?? undefined;

        if (Array.isArray(mediaItems)) {
          for (const media of mediaItems) {
            const info = media?.video_info;
            if (!info?.variants) {
              continue;
            }
            for (const variant of info.variants) {
              if (!variant?.url) {
                continue;
              }
              variants.push({
                url: variant.url as string,
                bitrate:
                  typeof variant.bitrate === 'number'
                    ? (variant.bitrate as number)
                    : typeof variant.bitrate === 'string'
                    ? Number.parseInt(variant.bitrate as string, 10)
                    : null,
                contentType:
                  typeof variant.content_type === 'string'
                    ? (variant.content_type as string)
                    : undefined,
                tweetId: possibleTweetId
              });
            }
          }
        }

        for (const value of Object.values(node)) {
          if (value && typeof value === 'object') {
            visit(value, possibleTweetId);
          }
        }
      };

      visit(parsed);

      const variantCount = variants.length;

      const candidates = id
        ? variants.filter((variant) => variant.tweetId === id || variant.url.includes(id))
        : variants;

      const preferred = (candidates.length > 0 ? candidates : variants)
        .filter((variant) => variant.url.includes('.mp4'))
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];

      if (!preferred) {
        return {
          url: null,
          tweetId: null,
          contentType: null,
          variantCount
        };
      }

      return {
        url: preferred.url,
        tweetId: preferred.tweetId ?? null,
        contentType: preferred.contentType ?? null,
        variantCount
      };
    }, tweetId);

    if (!result?.url) {
      if ((result?.variantCount ?? 0) > 0) {
        logger.info('Next data contained variants but no MP4 candidate', {
          tweetId,
          variantCount: result?.variantCount ?? 0
        });
      } else {
        logger.info('Next data missing video variants', { tweetId });
      }
      return undefined;
    }

    logger.info('Extracted video from next data', {
      source: result.url,
      tweetId: tweetId ?? result.tweetId ?? undefined
    });

    return { url: result.url };
  } catch (error) {
    logger.warn('Failed to extract video from next data', {
      tweetId,
      message: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}
