<?php
/**
 * Copy this file to `config.local.php` on the server (same folder as health.php)
 * and set a long random admin_token. Used to authorize GET /api/submissions.php?token=...
 *
 * IMPORTANT: Do not commit `config.local.php` to a public repo.
 */
return [
    'admin_token' => 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET',
];
