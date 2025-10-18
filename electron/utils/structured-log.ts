import log from 'electron-log';

export const structuredLog = {
  emit(event: string, payload: any) {
    try {
      log.debug(`[structured] ${event} ${JSON.stringify(payload)}`);
    } catch (e) {
      log.debug(`[structured] ${event} <unstringifiable>`);
    }
  }
};

export function getStructuredLogPath(): string | null {
  try {
    // electron-log default path
    return (log.transports.file as any)?.getFile()?.path || null;
  } catch {
    return null;
  }
}

export function emitVideoResult(payload: any) {
  structuredLog.emit('video:result', payload);
}
