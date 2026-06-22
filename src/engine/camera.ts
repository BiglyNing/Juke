/**
 * Webcam acquisition. Wraps getUserMedia and maps the messy set of DOMException
 * names into a small, friendly set of failure kinds so the shell can show a
 * clear message instead of crashing (Phase 1 exit criterion).
 */

export type CameraErrorKind =
  | 'unsupported' // browser has no getUserMedia (or insecure context)
  | 'denied' // user blocked the permission
  | 'notfound' // no camera device present
  | 'inuse' // device is held by another app
  | 'other';

export class CameraError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

export interface CameraHandle {
  readonly video: HTMLVideoElement;
  stop(): void;
}

const FRIENDLY: Record<CameraErrorKind, string> = {
  unsupported:
    "This browser can't access a webcam, or the page isn't on a secure (https/localhost) connection.",
  denied:
    'Juke needs your camera to see you move. Allow camera access in your browser, then try again.',
  notfound: "We couldn't find a webcam. Plug one in (or enable it) and try again.",
  inuse: 'Your camera is in use by another app (Zoom, Meet, etc.). Close it and try again.',
  other: 'Something went wrong starting the camera.',
};

function mapMediaError(err: unknown): CameraError {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', FRIENDLY.denied);
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new CameraError('notfound', FRIENDLY.notfound);
    case 'NotReadableError':
    case 'TrackStartError':
      return new CameraError('inuse', FRIENDLY.inuse);
    default:
      return new CameraError('other', `${FRIENDLY.other} (${(err as Error)?.message ?? name})`);
  }
}

/**
 * Requests the user-facing camera and returns a playing <video> element ready
 * to be fed to the perception layer. Throws a {@link CameraError} on failure.
 */
export async function startCamera(width = 640, height = 480): Promise<CameraHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unsupported', FRIENDLY.unsupported);
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: width },
        height: { ideal: height },
        facingMode: 'user',
      },
    });
  } catch (err) {
    throw mapMediaError(err);
  }

  const video = document.createElement('video');
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;

  try {
    await video.play();
    await waitForFirstFrame(video);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CameraError('other', `${FRIENDLY.other} (${(err as Error)?.message ?? 'playback failed'})`);
  }

  return {
    video,
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}

function waitForFirstFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true });
  });
}
