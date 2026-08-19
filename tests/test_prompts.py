import unittest

from local_translator.prompts import (
    extract_source_text,
    infer_target_language,
    parse_translation_input,
)


class PromptParsingTests(unittest.TestCase):
    def test_infers_english_from_english_instruction(self):
        self.assertEqual(infer_target_language("Translate the following text into English."), "English")

    def test_infers_chinese_from_chinese_instruction(self):
        self.assertEqual(infer_target_language("将以下文本翻译成中文"), "Chinese")

    def test_extracts_marked_source(self):
        value = "Translate into English.\n[Source Text]\n你好，世界。\n[End Source Text]"
        self.assertEqual(extract_source_text(value), "你好，世界。")

    def test_parses_openai_style_messages(self):
        request = parse_translation_input(
            {
                "messages": [
                    {"role": "system", "content": "Translate the following text into English."},
                    {"role": "user", "content": "你好，世界。"},
                ]
            }
        )
        self.assertEqual(request.target_language, "English")
        self.assertEqual(request.source_text, "你好，世界。")

    def test_removes_inline_instruction_from_user_message(self):
        request = parse_translation_input(
            {"messages": [{"role": "user", "content": "Translate into English:\n你好，世界。"}]}
        )
        self.assertEqual(request.source_text, "你好，世界。")


if __name__ == "__main__":
    unittest.main()
