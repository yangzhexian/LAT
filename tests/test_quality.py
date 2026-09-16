import unittest

from local_translator.quality import clean_model_output, is_fatal, protect_text, quality_issues


class QualityTests(unittest.TestCase):
    def test_end_source_wrappers_are_cleaned_without_rejecting_translation(self):
        for marker in ("[结束源文本]", "[End Source Text]"):
            protected = protect_text("你好")
            raw = "Hello\n" + marker
            cleaned = clean_model_output(raw, protected)
            self.assertEqual(cleaned, "Hello")
            self.assertFalse(is_fatal(quality_issues(raw, cleaned, protected, protected.source)))

    def test_source_owned_marker_is_preserved(self):
        protected = protect_text("标识 [结束源文本]")
        raw = "Marker " + next(iter(protected.tokens))
        self.assertEqual(clean_model_output(raw, protected), "Marker [结束源文本]")

    def test_code_with_formula_is_restored_exactly(self):
        source = "Example\n```tex\n$\\boldsymbol{x} \\in A$\n```"
        protected = protect_text(source)
        self.assertEqual(clean_model_output(protected.protected, protected), source)

    def test_protected_url_and_placeholder_are_restored(self):
        protected = protect_text("打开 https://example.com/{{id}} 查看")
        output = clean_model_output("Translation: Open ⟦KEEP_0⟧", protected)
        self.assertIn("https://example.com/{{id}}", output)

    def test_prompt_leak_is_detected(self):
        protected = protect_text("你好")
        raw = "[Source Text]\n你好\n[Translation]\nHello"
        cleaned = clean_model_output(raw, protected)
        issues = quality_issues(raw, cleaned, protected, "你好")
        self.assertIn("prompt_leak", issues)
        self.assertTrue(is_fatal(issues))

    def test_translation_label_is_removed(self):
        protected = protect_text("你好")
        self.assertEqual(clean_model_output("译文：Hello", protected), "Hello")

    def test_chinese_end_translation_marker_is_removed(self):
        protected = protect_text("你好")
        self.assertEqual(clean_model_output("Hello\n[结束翻译]", protected), "Hello")

    def test_latex_formulas_are_protected_and_restored(self):
        source = r"Text $x_i$ and $$y = x^2$$ plus \(z\) and \[w\]."
        protected = protect_text(source)
        self.assertNotIn("$x_i$", protected.protected)
        markers = " ".join(protected.tokens)
        restored = clean_model_output(f"文本 {markers}", protected)
        self.assertEqual(restored, "文本 " + " ".join(protected.tokens.values()))

    def test_missing_latex_marker_is_fatal(self):
        protected = protect_text(r"Text $x_i$")
        issues = quality_issues("文本", "文本", protected, protected.source)
        self.assertIn("missing_protected_token", issues)
        self.assertTrue(is_fatal(issues))


if __name__ == "__main__":
    unittest.main()
