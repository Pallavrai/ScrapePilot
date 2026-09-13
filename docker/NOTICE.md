`seccomp_profile.json` is from Microsoft Playwright v1.63.0, licensed Apache-2.0:
https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json

The profile extends Docker's default syscall policy with user namespace operations required by Chromium's sandbox. Browser processes run as the non-root node user. Do not substitute an unconfined profile or disable Chromium's sandbox to work around deployment errors.

Local modification: allow the `chroot` syscall without a host capability condition. With all container capabilities dropped, Chromium needs this syscall inside its own user namespace; the kernel still enforces namespace capabilities. Verified with a non-root, cap-drop=ALL, no-new-privileges container smoke test.
