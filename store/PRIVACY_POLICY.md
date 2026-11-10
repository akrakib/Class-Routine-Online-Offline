# Privacy Policy — Class Routine 2.0

**Publisher:** Binary Prokashoni  
**Last updated:** November 9, 2026

Class Routine displays published class schedules and academic announcements for the selected 4th Semester group (A or B).

## Data stored on the device

The selected group and the last successfully downloaded routine are stored locally to support offline access. Existing profile preferences and locally retained app settings may also remain on the device. Uninstalling the app may remove this local data.

## Data sent to the service

When online synchronization is configured, the app sends a read-only request for the selected semester/group to the Cloudflare Worker service. The service returns published class information and announcements. The service provider may process standard request metadata (such as IP address and request time) for service operation and abuse prevention. The student app does not require a student account and does not send a student password.

## Administrator data

The separate Admin Panel is restricted to the administrator. Administrator login credentials are stored as salted PBKDF2-SHA256 password hashes in Cloudflare D1. Admin session tokens are random, stored as hashes server-side, and delivered using secure HttpOnly cookies.

## Permissions and third parties

The app requires internet access for online routine synchronization. It does not require access to contacts, location, camera, or microphone. The backend uses Cloudflare Workers and D1. Cloudflare's privacy terms apply to data processed by its infrastructure.

## Contact

Binary Prokashoni — https://github.com/binary-prokashoni
