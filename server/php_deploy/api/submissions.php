<?php
/**
 * POST JSON body (same shape as the Android app) to record + grade a submission.
 * GET ?token=... to list all submissions (admin).
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/includes/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $token = isset($_GET['token']) ? (string) $_GET['token'] : '';
    if ($token !== html_test_admin_token()) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'unauthorized'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
    try {
        $subs = html_test_read_submissions();
        echo json_encode(['ok' => true, 'submissions' => $subs], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    } catch (Throwable $e) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'read_failed'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    exit;
}

if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    if ($raw === false) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'empty_body'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
    $body = json_decode($raw, true);
    if (!is_array($body)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'invalid_json'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    [$ok, $err, $normalized] = html_test_validate_submission_body($body);
    if (!$ok || $normalized === null) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => $err ?? 'bad_request'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    try {
        $key = html_test_load_answer_key();
        $grade = html_test_grade_submission($normalized, $key);

        $id = bin2hex(random_bytes(16));
        $row = [
            'id' => $id,
            'receivedAt' => gmdate('c'),
            'participantLabel' => isset($body['participantLabel']) ? $body['participantLabel'] : null,
            'clientSubmittedAt' => isset($body['clientSubmittedAt']) ? $body['clientSubmittedAt'] : null,
            'answers' => $normalized,
            'graded' => $grade['graded'],
            'scoreTotal' => $grade['scoreTotal'],
            'scoreMax' => $grade['scoreMax'],
            'userAgent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
        ];

        html_test_append_submission($row);
        echo json_encode(['ok' => true, 'id' => $id], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    } catch (Throwable $e) {
        http_response_code(500);
        $code = $e->getMessage();
        $map = [
            'answer_key_missing' => 'answer_key_missing',
            'answer_key_read_failed' => 'answer_key_missing',
            'answer_key_invalid' => 'answer_key_missing',
            'store_failed' => 'store_failed',
            'data_dir_create_failed' => 'store_failed',
        ];
        $err = $map[$code] ?? 'store_failed';
        echo json_encode(['ok' => false, 'error' => $err], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    exit;
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'method_not_allowed'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
