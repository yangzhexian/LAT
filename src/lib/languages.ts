export interface LanguageOption {
  code: string;
  name: string;
  label: string;
}

// Names follow the Hy-MT2 language list. The model receives `name`, while
// the UI displays the friendlier Chinese label.
export const LANGUAGES: LanguageOption[] = [
  { code: "auto", name: "Auto Detect", label: "自动检测" },
  { code: "zh", name: "Chinese", label: "中文" },
  { code: "en", name: "English", label: "英语" },
  { code: "fr", name: "French", label: "法语" },
  { code: "pt", name: "Portuguese", label: "葡萄牙语" },
  { code: "es", name: "Spanish", label: "西班牙语" },
  { code: "ja", name: "Japanese", label: "日语" },
  { code: "tr", name: "Turkish", label: "土耳其语" },
  { code: "ru", name: "Russian", label: "俄语" },
  { code: "ar", name: "Arabic", label: "阿拉伯语" },
  { code: "ko", name: "Korean", label: "韩语" },
  { code: "th", name: "Thai", label: "泰语" },
  { code: "it", name: "Italian", label: "意大利语" },
  { code: "de", name: "German", label: "德语" },
  { code: "vi", name: "Vietnamese", label: "越南语" },
  { code: "ms", name: "Malay", label: "马来语" },
  { code: "id", name: "Indonesian", label: "印度尼西亚语" },
  { code: "tl", name: "Filipino", label: "菲律宾语" },
  { code: "hi", name: "Hindi", label: "印地语" },
  { code: "zh-Hant", name: "Traditional Chinese", label: "繁体中文" },
  { code: "pl", name: "Polish", label: "波兰语" },
  { code: "cs", name: "Czech", label: "捷克语" },
  { code: "nl", name: "Dutch", label: "荷兰语" },
  { code: "km", name: "Khmer", label: "高棉语" },
  { code: "my", name: "Burmese", label: "缅甸语" },
  { code: "fa", name: "Persian", label: "波斯语" },
  { code: "gu", name: "Gujarati", label: "古吉拉特语" },
  { code: "ur", name: "Urdu", label: "乌尔都语" },
  { code: "te", name: "Telugu", label: "泰卢固语" },
  { code: "mr", name: "Marathi", label: "马拉地语" },
  { code: "he", name: "Hebrew", label: "希伯来语" },
  { code: "bn", name: "Bengali", label: "孟加拉语" },
  { code: "ta", name: "Tamil", label: "泰米尔语" },
  { code: "uk", name: "Ukrainian", label: "乌克兰语" },
  { code: "bo", name: "Tibetan", label: "藏语" },
  { code: "kk", name: "Kazakh", label: "哈萨克语" },
  { code: "mn", name: "Mongolian", label: "蒙古语" },
  { code: "ug", name: "Uyghur", label: "维吾尔语" },
  { code: "yue", name: "Cantonese", label: "粤语" },
];

export function languageName(code: string): string {
  return LANGUAGES.find((item) => item.code === code)?.name ?? code;
}

