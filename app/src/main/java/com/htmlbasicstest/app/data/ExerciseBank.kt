package com.htmlbasicstest.app.data

/**
 * v2 loads all questions from the server (`GET …/api/quiz.php`). This object is intentionally empty.
 * Authoring lives in `server/quiz_content.json` on the host; visibility rules in `server/quiz_publish.json`.
 */
object ExerciseBank {
    val exercises: List<Exercise> = emptyList()
}
