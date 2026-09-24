import { num, record, requiredStr, str } from '../parse.js';
import type { Get } from './get.js';

export interface Profile {
  /** Garmin's handle for the account, part of several endpoint URLs. Not the email. */
  displayName: string;
  fullName: string | null;
  profileId: number | null;
}

export async function fetchProfile(get: Get): Promise<Profile> {
  const body = record(await get('profile', '/userprofile-service/socialProfile'), 'profile');
  return {
    displayName: requiredStr(body['displayName'], 'profile.displayName'),
    fullName: str(body['fullName']),
    profileId: num(body['profileId']),
  };
}
