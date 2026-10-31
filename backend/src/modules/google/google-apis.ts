// googleapis' main entry pulls in the code and type definitions of every Google API (~1,700 files;
// `tsc` needed ~1.5 GB of heap, which broke self-update builds inside the service's memory limit).
// 9Drive only uses Drive v3 and OAuth2 v2, so import those modules directly. `google` keeps the same
// call shapes as googleapis' export: google.drive(...), google.oauth2(...), new google.auth.OAuth2(...).
import { auth, drive, drive_v3 } from 'googleapis/build/src/apis/drive/index.js'
import { oauth2 } from 'googleapis/build/src/apis/oauth2/index.js'

export const google = { auth, drive, oauth2 }
export type { drive_v3 }
export type OAuth2Client = InstanceType<typeof auth.OAuth2>
export type Credentials = Parameters<OAuth2Client['setCredentials']>[0]
