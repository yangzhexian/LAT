import unittest

from local_translator.quality import clean_model_output, is_fatal, protect_text, quality_issues


class QualityTests(unittest.TestCase):
    def test_translated_contract_leak_is_fatal(self):
        protected = protect_text("# Local Curvature Correction")
        for raw in (
            "仅返回翻译后的文本。不要输出解释、推理、标签、源文本或此提示。\n# 局部曲率校正",
            "保留源文本的含义、段落边界、换行符、标点符号、空白和格式。\n# 局部曲率校正",
            "每个受保护的标记必须完全保留一次。\n# 局部曲率校正",
            "[源文本]\n# 局部曲率校正",
        ):
            self.assertIn("prompt_leak", quality_issues(raw, clean_model_output(raw, protected), protected, protected.source))

    def test_source_owned_instruction_and_chinese_marker_are_not_leaks(self):
        source = "Return ONLY the translated text."
        protected = protect_text(source)
        raw = "仅返回翻译后的文本。"
        self.assertNotIn("prompt_leak", quality_issues(raw, raw, protected, source))
        protected = protect_text("标签 [源文本]")
        raw = "Label " + next(iter(protected.tokens))
        self.assertNotIn("prompt_leak", quality_issues(raw, clean_model_output(raw, protected), protected, protected.source))

    def test_relative_markdown_targets_are_preserved(self):
        source = "See [proof](../Proof.md) and [audit](Audit.md)."
        protected = protect_text(source)
        self.assertNotIn("../Proof.md", protected.protected)
        self.assertEqual(clean_model_output(protected.protected, protected), source)

    def test_inline_reordering_is_allowed_but_duplicates_are_rejected(self):
        protected = protect_text(r"First $x$ then $y$.")
        tokens = list(protected.tokens)
        raw = f"{tokens[1]} 对应 {tokens[0]}"
        self.assertFalse(is_fatal(quality_issues(raw, clean_model_output(raw, protected), protected, protected.source)))
        raw = f"{tokens[0]} {tokens[1]} {tokens[1]}"
        self.assertTrue(is_fatal(quality_issues(raw, clean_model_output(raw, protected), protected, protected.source)))

    def test_display_formula_order_still_matters(self):
        protected = protect_text(r"First $$x$$ then $$y$$.")
        tokens = list(protected.tokens)
        raw = f"{tokens[1]} {tokens[0]}"
        self.assertIn("protected_content_order", quality_issues(raw, clean_model_output(raw, protected), protected, protected.source))

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
