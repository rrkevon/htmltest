package com.htmlbasicstest.app.data

// 30 questions for an early Mimo-style HTML class:
//   - 10 multiple choice (ids 1-10)
//   - 12 short text       (ids 11-22)
//   - 8  fill-in-the-blank (ids 23-30)
//
// IMPORTANT: Correct answers do NOT live here. They live on the server
// (see server/answer_key.json) so the answer key cannot be read out of the APK.
object ExerciseBank {
    val exercises: List<Exercise> = listOf(

        // ---------- Multiple choice ----------

        // Correct answer letter is varied across questions so it isn't always 'a'.
        // The matching letters live in server/answer_key.json.

        Exercise.MultipleChoice(
            id = 1,
            title = "What HTML is",
            prompt = "What does HTML let you create?",
            choices = listOf(
                Choice("a", "Songs"),
                Choice("b", "Spreadsheets"),
                Choice("c", "Web pages"),
                Choice("d", "Video games"),
            ),
        ),
        Exercise.MultipleChoice(
            id = 2,
            title = "Open / close tag",
            prompt = "Which line correctly writes a paragraph that says Hello?",
            choices = listOf(
                Choice("a", "<p>Hello"),
                Choice("b", "<p>Hello</p>"),
                Choice("c", "<p Hello /p>"),
                Choice("d", "p Hello p"),
            ),
        ),
        Exercise.MultipleChoice(
            id = 3,
            title = "Heading size",
            prompt = "Which tag makes text the LARGEST by default?",
            choices = listOf(
                Choice("a", "<h1>"),
                Choice("b", "<h2>"),
                Choice("c", "<h3>"),
                Choice("d", "<p>"),
            ),
        ),
        Exercise.MultipleChoice(
            id = 4,
            title = "Bold text",
            prompt = "Which tag is usually shown as BOLD text?",
            choices = listOf(
                Choice("a", "<em>"),
                Choice("b", "<strong>"),
                Choice("c", "<p>"),
                Choice("d", "<h1>"),
            ),
        ),
        Exercise.MultipleChoice(
            id = 5,
            title = "Italic text",
            prompt = "Which tag is usually shown as ITALIC text?",
            choices = listOf(
                Choice("a", "<strong>"),
                Choice("b", "<p>"),
                Choice("c", "<br>"),
                Choice("d", "<em>"),
            ),
        ),
        Exercise.MultipleChoice(
            id = 6,
            title = "A correct link",
            prompt = "Which line creates a link to https://example.com that says Click here?",
            choices = listOf(
                Choice("a", "<a href=\"https://example.com\">Click here</a>"),
                Choice("b", "<a>https://example.com Click here</a>"),
                Choice("c", "<link href=\"https://example.com\">Click here</link>"),
                Choice("d", "<a src=\"https://example.com\">Click here</a>"),
            ),
        ),
        Exercise.MultipleChoice(
            id = 7,
            title = "A correct image",
            prompt = "Which line shows an image cat.png with the description A cat?",
            choices = listOf(
                Choice("a", "<img href=\"cat.png\">A cat</img>"),
                Choice("b", "<image src=\"cat.png\">A cat</image>"),
                Choice("c", "<img src=\"cat.png\" alt=\"A cat\">"),
                Choice("d", "<img>cat.png A cat</img>"),
            ),
        ),
        Exercise.MultipleChoice(
            id = 8,
            title = "Body tag",
            prompt = "Which tag holds everything the user SEES on the page?",
            choices = listOf(
                Choice("a", "<head>"),
                Choice("b", "<title>"),
                Choice("c", "<html>"),
                Choice("d", "<body>"),
            ),
        ),
        Exercise.MultipleChoice(
            id = 9,
            title = "Title location",
            prompt = "Where does the page TITLE (shown in the browser tab) go?",
            choices = listOf(
                Choice("a", "Inside <head>"),
                Choice("b", "Inside <body>"),
                Choice("c", "Inside <p>"),
                Choice("d", "Inside <a>"),
            ),
        ),
        Exercise.MultipleChoice(
            id = 10,
            title = "What <br> does",
            prompt = "What does <br> do?",
            choices = listOf(
                Choice("a", "Starts a new paragraph"),
                Choice("b", "Adds a line break inside text"),
                Choice("c", "Makes text bold"),
                Choice("d", "Adds an image"),
            ),
        ),

        // ---------- Short text ----------
        // Rule shown to the student: type the answer exactly as it appears in code.
        // For tags, that means including the angle brackets (e.g. <p>).

        Exercise.ShortText(
            id = 11,
            title = "Paragraph tag",
            prompt = "Type the tag used for a paragraph. Include the angle brackets.",
            placeholder = "e.g. <p>",
        ),
        Exercise.ShortText(
            id = 12,
            title = "Largest heading",
            prompt = "Type the tag for the LARGEST heading.",
            placeholder = "Include the angle brackets",
        ),
        Exercise.ShortText(
            id = 13,
            title = "Second-largest heading",
            prompt = "Type the tag for the SECOND-largest heading.",
            placeholder = "Include the angle brackets",
        ),
        Exercise.ShortText(
            id = 14,
            title = "Line break",
            prompt = "Type the tag that adds a single line break.",
            placeholder = "Include the angle brackets",
        ),
        Exercise.ShortText(
            id = 15,
            title = "Bold (strongly important)",
            prompt = "Type the tag that makes text BOLD (the one that means strongly important).",
            placeholder = "Include the angle brackets",
        ),
        Exercise.ShortText(
            id = 16,
            title = "Italic (emphasis)",
            prompt = "Type the tag that makes text ITALIC (the one used for emphasis).",
            placeholder = "Include the angle brackets",
        ),
        Exercise.ShortText(
            id = 17,
            title = "Clickable link",
            prompt = "What tag do you use to make a clickable link?",
            placeholder = "Include the angle brackets",
        ),
        Exercise.ShortText(
            id = 18,
            title = "Show an image",
            prompt = "What tag do you use to put an image on a page?",
            placeholder = "Include the angle brackets",
        ),
        Exercise.ShortText(
            id = 19,
            title = "Whole page",
            prompt = "What tag holds the WHOLE web page? Everything else goes inside it.",
            placeholder = "Include the angle brackets",
        ),
        Exercise.ShortText(
            id = 20,
            title = "Behind-the-scenes",
            prompt = "What tag holds the page's title and other behind-the-scenes settings?",
            placeholder = "Include the angle brackets",
        ),
        Exercise.ShortText(
            id = 21,
            title = "Visible content",
            prompt = "What tag holds everything the user SEES on the page?",
            placeholder = "Include the angle brackets",
        ),
        Exercise.ShortText(
            id = 22,
            title = "Link destination word",
            prompt = "In <a href=\"...\">Home</a>, which word goes right before the equals sign (=) to say where the link goes?",
            placeholder = "Just the word, no quotes",
        ),

        // ---------- Fill in the blank ----------
        // Student types only what fills the ____ blank, exactly as it would appear in code.

        Exercise.FillBlank(
            id = 23,
            title = "Close a paragraph",
            prompt = "Fill in the blank to close the paragraph correctly.",
            code = "<p>Hello____",
            placeholder = "e.g. </something>",
        ),
        Exercise.FillBlank(
            id = 24,
            title = "Open a heading",
            prompt = "Fill in the blank to open the heading correctly.",
            code = "____Welcome!</h1>",
            placeholder = "e.g. <something>",
        ),
        Exercise.FillBlank(
            id = 25,
            title = "Link destination",
            prompt = "Fill in the blank so the link points to a web address.",
            code = "<a ____=\"https://example.com\">Visit</a>",
            placeholder = "Just the word",
        ),
        Exercise.FillBlank(
            id = 26,
            title = "Image file",
            prompt = "Fill in the blank so the image knows which file to show.",
            code = "<img ____=\"dog.png\" alt=\"A dog\">",
            placeholder = "Just the word",
        ),
        Exercise.FillBlank(
            id = 27,
            title = "Image description",
            prompt = "Fill in the blank with the word that gives the image its description.",
            code = "<img src=\"dog.png\" ____=\"A dog\">",
            placeholder = "Just the word",
        ),
        Exercise.FillBlank(
            id = 28,
            title = "Page skeleton",
            prompt = "Fill in the missing tag name (no angle brackets — they are already there).",
            code = """
                <html>
                  <head>
                    <title>My page</title>
                  </head>
                  <____>The page content goes here.</____>
                </html>
            """.trimIndent(),
            placeholder = "Just the tag name",
        ),
        Exercise.FillBlank(
            id = 29,
            title = "Close bold text",
            prompt = "Fill in the blank to close the bold text correctly.",
            code = "<strong>Hello____",
            placeholder = "e.g. </something>",
        ),
        Exercise.FillBlank(
            id = 30,
            title = "Close a link",
            prompt = "Fill in the blank to close the link correctly.",
            code = "<a href=\"https://example.com\">Click here____",
            placeholder = "e.g. </something>",
        ),
    )
}
