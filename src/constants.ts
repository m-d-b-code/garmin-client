// Everything Garmin can change without notice lives here, so a breakage is fixed in one file.
// Values are taken from python-garminconnect `garminconnect/client.py` (DI OAuth2 flow, 2026).

export const SSO_ORIGIN = 'https://sso.garmin.com';
export const CONNECT_API_ORIGIN = 'https://connectapi.garmin.com';
export const DI_TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';

// iOS app flow: `POST /mobile/api/login` returns JSON, no HTML form to scrape.
export const IOS_SSO_CLIENT_ID = 'GCM_IOS_DARK';
export const IOS_SERVICE_URL = 'https://mobile.integration.garmin.com/gcm/ios';
export const IOS_LOGIN_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

export const MOBILE_LOGIN_PATH = '/mobile/api/login';
export const MOBILE_MFA_VERIFY_PATH = '/mobile/api/mfa/verifyCode';

export const DI_GRANT_TYPE_SERVICE_TICKET =
  'https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket';

// Tried in order: Garmin retires old client IDs, the first one accepted wins.
export const DI_CLIENT_IDS = [
  'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI',
  'GARMIN_CONNECT_MOBILE_IOS_DI',
] as const;

// Headers of the Android app, sent with DI token calls and API calls.
export const NATIVE_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': 'GCM-Android-5.23',
  'X-Garmin-User-Agent':
    'com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; ' +
    'Android/33; Dalvik/2.1.0',
  'X-Garmin-Paired-App-Version': '10861',
  'X-Garmin-Client-Platform': 'Android',
  'X-App-Ver': '10861',
  'X-Lang': 'en',
  'X-GCExperience': 'GC5',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** Refresh the access token this long before its `exp`. */
export const REFRESH_MARGIN_MS = 15 * 60 * 1000;

export const DEFAULT_TIMEOUT_MS = 30_000;
