<?php
/**
 * Shared helpers for the HTML basics test PHP API (ByetHost / generic PHP hosting).
 */

declare(strict_types=1);

function html_test_root(): string
{
    return dirname(__DIR__);
}

function html_test_admin_token(): string
{
    $f = html_test_root() . '/config.local.php';
    if (is_readable($f)) {
        $c = include $f;
        if (is_array($c) && isset($c['admin_token']) && is_string($c['admin_token']) && $c['admin_token'] !== '') {
            return $c['admin_token'];
        }
    }
    return 'devtoken';
}

function html_test_answer_key_path(): string
{
    return html_test_root() . '/answer_key.json';
}

function html_test_store_path(): string
{
    return html_test_root() . '/data/submissions.ndjson';
}

function html_test_load_answer_key(): array
{
    $p = html_test_answer_key_path();
    if (!is_readable($p)) {
        throw new RuntimeException('answer_key_missing');
    }
    $raw = file_get_contents($p);
    if ($raw === false) {
        throw new RuntimeException('answer_key_read_failed');
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        throw new RuntimeException('answer_key_invalid');
    }
    $out = [];
    foreach ($data as $k => $v) {
        if (!is_string($k) || $k === '' || $k[0] === '$') {
            continue;
        }
        if (!is_array($v)) {
            continue;
        }
        $out[(string) $k] = $v;
    }
    return $out;
}

function html_test_normalize_text(string $s): string
{
    $s = trim($s);
    if (function_exists('mb_strtolower')) {
        return mb_strtolower($s, 'UTF-8');
    }
    return strtolower($s);
}

/**
 * @param array<string,mixed> $keyRow
 * @param array<string,mixed> $ansRow
 */
function html_test_grade_one(int $exerciseId, array $keyRow, array $ansRow): bool
{
    $type = isset($keyRow['type']) ? (string) $keyRow['type'] : '';

    if ($type === 'mcq') {
        $sel = isset($ansRow['selectedChoiceId']) && is_string($ansRow['selectedChoiceId'])
            ? html_test_normalize_text($ansRow['selectedChoiceId'])
            : '';
        $cor = isset($keyRow['correctChoiceId']) ? html_test_normalize_text((string) $keyRow['correctChoiceId']) : '';
        return $sel !== '' && $cor !== '' && $sel === $cor;
    }

    if ($type === 'text') {
        $typed = isset($ansRow['typedAnswer']) && is_string($ansRow['typedAnswer'])
            ? trim($ansRow['typedAnswer'])
            : '';
        if ($typed === '') {
            return false;
        }
        $typedNorm = html_test_normalize_text($typed);
        $accepted = $keyRow['acceptedAnswers'] ?? null;
        if (!is_array($accepted)) {
            return false;
        }
        foreach ($accepted as $acc) {
            if (!is_string($acc)) {
                continue;
            }
            if ($typedNorm === html_test_normalize_text($acc)) {
                return true;
            }
        }
        return false;
    }

    return false;
}

/**
 * @param array<int,array<string,mixed>> $answers
 * @return array{graded: list<array<string,mixed>>, scoreTotal: int, scoreMax: int}
 */
function html_test_grade_submission(array $answers, array $key): array
{
    $graded = [];
    $scoreTotal = 0;
    $scoreMax = 0;

    foreach ($answers as $row) {
        if (!is_array($row)) {
            continue;
        }
        $eid = isset($row['exerciseId']) ? (int) $row['exerciseId'] : 0;
        if ($eid < 1) {
            continue;
        }
        $kid = (string) $eid;
        if (!isset($key[$kid])) {
            $graded[] = [
                'exerciseId' => $eid,
                'correct' => false,
                'reason' => 'unknown_exercise',
            ];
            ++$scoreMax;
            continue;
        }
        $keyRow = $key[$kid];
        $ok = html_test_grade_one($eid, $keyRow, $row);
        if ($ok) {
            ++$scoreTotal;
        }
        ++$scoreMax;

        $entry = [
            'exerciseId' => $eid,
            'type' => $keyRow['type'] ?? null,
            'correct' => $ok,
        ];
        if (isset($row['selectedChoiceId'])) {
            $entry['selectedChoiceId'] = $row['selectedChoiceId'];
        }
        if (isset($row['typedAnswer'])) {
            $entry['typedAnswer'] = $row['typedAnswer'];
        }
        $graded[] = $entry;
    }

    return ['graded' => $graded, 'scoreTotal' => $scoreTotal, 'scoreMax' => $scoreMax];
}

/**
 * @param array<string,mixed>|null $body
 * @return array{0: bool, 1: string|null, 2: list<array<string,mixed>>|null}
 */
function html_test_validate_submission_body(?array $body): array
{
    if ($body === null) {
        return [false, 'invalid_json', null];
    }
    $answers = $body['answers'] ?? null;
    if (!is_array($answers)) {
        return [false, 'answers_required', null];
    }
    if (count($answers) !== 30) {
        return [false, 'answers_count', null];
    }
    $ids = [];
    $normalized = [];
    foreach ($answers as $row) {
        if (!is_array($row)) {
            return [false, 'answer_shape', null];
        }
        if (!array_key_exists('exerciseId', $row)) {
            return [false, 'exercise_id_required', null];
        }
        $eid = (int) $row['exerciseId'];
        if ($eid < 1 || $eid > 30) {
            return [false, 'exercise_id_range', null];
        }
        if (isset($ids[$eid])) {
            return [false, 'duplicate_exercise_id', null];
        }
        $ids[$eid] = true;

        $hasChoice = array_key_exists('selectedChoiceId', $row) && $row['selectedChoiceId'] !== null && $row['selectedChoiceId'] !== '';
        $hasTyped = array_key_exists('typedAnswer', $row) && $row['typedAnswer'] !== null && trim((string) $row['typedAnswer']) !== '';

        $summ = [
            'exerciseId' => $eid,
            'selectedChoiceId' => $hasChoice ? (string) $row['selectedChoiceId'] : null,
            'typedAnswer' => $hasTyped ? (string) $row['typedAnswer'] : null,
        ];
        $normalized[] = $summ;
    }
    for ($i = 1; $i <= 30; ++$i) {
        if (!isset($ids[$i])) {
            return [false, 'missing_exercise_id', null];
        }
    }

    return [true, null, $normalized];
}

function html_test_ensure_data_dir(): void
{
    $dir = html_test_root() . '/data';
    if (!is_dir($dir)) {
        if (!@mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new RuntimeException('data_dir_create_failed');
        }
    }
}

/**
 * @param array<string,mixed> $row
 */
function html_test_append_submission(array $row): void
{
    html_test_ensure_data_dir();
    $p = html_test_store_path();
    $line = json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    if (file_put_contents($p, $line, FILE_APPEND | LOCK_EX) === false) {
        throw new RuntimeException('store_failed');
    }
}

/**
 * @return list<array<string,mixed>>
 */
function html_test_read_submissions(): array
{
    html_test_ensure_data_dir();
    $p = html_test_store_path();
    if (!is_readable($p)) {
        return [];
    }
    $raw = file_get_contents($p);
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $lines = preg_split("/\r\n|\n|\r/", trim($raw)) ?: [];
    $out = [];
    foreach ($lines as $line) {
        if ($line === '') {
            continue;
        }
        $j = json_decode($line, true);
        if (is_array($j)) {
            $out[] = $j;
        }
    }
    return $out;
}
