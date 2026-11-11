# LAT 0.2.1-beta.2 划词翻译设计

## 目标与技术选择

面向 Windows 桌面，为已经启用的本地 Hy-MT2 模型提供“选中文字后点浮标”和“按全局快捷键”两种入口。首轮兼容性验收集中在 Chrome、Edge 的网页及内置 PDF 阅读器；真实跨软件行为以用户验收记录为准。

选择 **Rust 原生 UI Automation（UIA）取词优先、用户明确触发时模拟复制兜底、独立 Tauri 翻译浮窗**。继续使用现有 Python 网关与 llama.cpp 模型，不引入 Electron、浏览器扩展或另一套翻译后端。

| 方式 | 特点 | 本版决定 |
| --- | --- | --- |
| UIA 文本选区 | 可直接访问支持无障碍文本接口的应用，不改变剪贴板；兼容程度取决于目标应用 | 首选 |
| 模拟复制 | 可以覆盖一部分无法从 UIA 读到的选区；需要处理焦点、剪贴板和权限问题 | 明确触发后按需兜底，可关闭 |
| 持续监听剪贴板 | 能响应复制操作，但难以区分普通复制与翻译意图 | 不使用 |
| 浏览器扩展 | 网页选区、DOM 和位置获取方便，限于浏览器且需要额外部署 | 不纳入本版 |
| 截图 OCR | 可处理图片与扫描 PDF，另需截图交互和 OCR 推理 | 不纳入本版 |

参考实现 `selection-hook` 展示了原生选区接口与复制兜底的组合思路；LAT 只参考架构，系统集成由 Rust 实现，不直接嵌入该项目的 Node/Electron 运行时。

## 操作和生命周期

- 新安装及旧版升级后，划词翻译默认关闭；默认快捷键为 `Ctrl+Alt+T`，支持修改并报告注册冲突。首次启用时同时打开“关闭到托盘”，之后可单独修改。
- 鼠标拖选或双击选词后尝试取得选区，显示不抢焦点的毛玻璃浮标；点击后才调用模型。快捷键直接取词并打开翻译浮窗。
- 原生接口无法提供文字时，只在有文本区域依据的划选操作后显示候选浮标；无法确认的控件通过快捷键尝试。空选区、过期选区或取词失败不读取旧剪贴板冒充新原文。
- 外部点击、滚动、应用切换、新选择及约 5 秒超时会隐藏或替换浮标。翻译运行期间忽略新的取词请求，避免原任务被覆盖。
- 浮窗提供折叠原文、目标语言、复制译文、重试、固定、转到主窗口、关闭，以及文本/LaTeX 预览。未固定时失焦关闭，固定后保留。
- 原文自动识别；浮窗目标语言默认中文并独立记忆，不改变主窗口的语言选择。浮窗沿用主窗口主题和减少动态效果设置。
- 浮窗直接翻译上限为 **5,000 个 Unicode 字符**，中文、英文和单个补充平面字符按字符计数。超过上限保留完整文本并提示转到主窗口，不静默截断。主窗口已有内容时需要确认替换。
- 模型未启用时保留文字，提供前往主窗口启用的操作，不自动下载或加载。模型正在翻译时立即提示稍后重试，不排队、不抢占。
- 完整成功的结果才写入现有本地翻译历史，遵守历史开关和条数限制；新记录标注“划词翻译”，旧记录仍显示普通翻译。
- 托盘提供打开主窗口、暂停/恢复划词、退出。暂停只作用于当前会话，重启后按持久化的启用设置恢复。关闭到托盘保留网关和已启用模型；真正退出释放监听、快捷键、网关和模型。再次启动不会自动恢复上次的选区原文；本版不增加开机自启。

## 系统集成与数据边界

鼠标钩子只转交原始坐标、消息和时间，不在回调中查询窗口或执行 UIA。监听线程通过 `MsgWaitForMultipleObjectsEx` 等待消息，输入到达即唤醒，替代 beta.1 每轮固定休眠 12 毫秒的循环；50 毫秒等待期限只用于检查启停状态。窗口命中测试与进程核对在协调线程执行，事件队列容量为 16，满时直接丢弃并使旧请求失效。Microsoft 文档要求低级钩子及时返回，超时可能被系统移除，见 [LowLevelMouseProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelmouseproc)。

鼠标事件不因 `LLMHF_INJECTED` 标记被排除。2026-09-30 原生诊断观察到用户划选路径的事件带有此标记，旧过滤会在手势判定之前丢弃它们。鼠标重映射、远程输入及辅助工具也可能使用注入事件；仍须经过同窗口手势、前台窗口、密码控件及输入修订号检查。LAT 不模拟鼠标输入；复制兜底的键盘输入通过 `KEYBDINPUT.dwExtraInfo` 添加专用标记，键盘钩子只忽略带有该标记且确为注入的 LAT 自身事件。其他注入按键也计入选区失效及剪贴板活动保护。Windows 标记含义见 [MSLLHOOKSTRUCT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-msllhookstruct) 和 [KBDLLHOOKSTRUCT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-kbdllhookstruct)。

UIA 查询在一个常驻的 COM MTA 工作线程执行。待查询队列容量为 1，控件祖先向上最多检查 6 层，调用方等待期限为 700 毫秒；检查请求编号及输入活动修订号，避免等待期间发生的新鼠标或非修饰键操作产生迟到浮标或错误翻译。超时后停止使用该请求结果，不创建替代线程；通道尚未恢复时提示改用手动粘贴，原查询返回后恢复使用。

浮标的原生鼠标按下与抬起须均命中同一浮标窗口，再直接发起激活，不依赖 WebView2 在非激活窗口中的首次网页点击。网页按钮只保留辅助功能的合成点击入口，避免同一物理点击提交两次。快捷键请求在协调线程处理时分配编号，并验证触发时的输入修订号，避免先到但尚未处理的鼠标事件误使快捷键过期。

浮标显示与隐藏统一使用 Tauri 窗口接口，维持框架可见状态与原生窗口一致；浮标创建时保持不聚焦且不可聚焦，不再通过原生 `ShowWindow` 绕过框架状态。对已确认的拖选/双击，先等待 70 毫秒读 UIA；如果仅暂时没有文字且无错误，再等待 100 毫秒重读一次。重试前后核对请求、焦点及输入修订号，不模拟复制，不对密码或超时错误重试。

浮窗标题栏通过限定当前浮窗的应用命令发起拖动，覆盖标题文字、图标和空白区域，并排除按钮区域。固定只控制驻留和置顶，不控制能否拖动。收到失焦事件后在后台等待 40 毫秒再核对实际前台窗口；前台窗口暂时为空时最多核对三次。只有同一请求仍未固定、且实际前台已切换时，才在主线程关闭；内部焦点转移、拖动或旧请求的迟到事件不会关闭当前浮窗。前台窗口含义见 [GetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow)。

选区快照使用独立 `requestId`。Rust 暂存当前请求，窗口完成初始化后主动获取快照；后续事件通知状态变化，避免浮窗创建过程中丢失原文。迟到的取词与翻译响应必须经过请求身份检查。浮窗使用轻量入口，不重复启动网关、创建模型或挂载完整主界面。

位置计算使用当前显示器工作区和 DPI；初始浮窗约 `440 × 360`，允许调整大小，浮标及浮窗应限制在可用屏幕范围内。实际跨屏及浏览器原生 PDF 工具条的相对位置由手动验收确认。

翻译浮窗通过 `DWMWA_WINDOW_CORNER_PREFERENCE` 请求 Windows 绘制标准圆角，内容区填满客户区，不再额外绘制外层 CSS 圆角或边框。旧 Windows 版本保留其系统几何形状；最终视觉表现由复验确认。参见 [Windows 系统圆角](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-rounded-corners)。

复制兜底仅在用户点击浮标或按快捷键后执行一次，执行前核对选区所属窗口和当前焦点，并等待快捷键修饰键释放。先备份能安全恢复的剪贴板格式，再模拟复制并等待新的文本；记录第一次观察到的剪贴板序号，在加锁后及延迟格式读取后重新核对序号和来源。输入监听累计除 LAT 自身复制按键以外的活动计数，不保存按键或输入内容；期间出现用户新操作时停止自动恢复，保留当前剪贴板。无法完整、安全备份的格式拒绝自动复制。开发验收须分别覆盖普通文本、HTML/RTF、图片、文件列表及复制无响应。

备份总量上限为 16 MiB。可恢复格式限于已知的内存格式：文本、Unicode/OEM 文本、区域信息、DIB/DIBV5、HDROP 文件列表，以及已知的 HTML/RTF/PNG 注册格式。位图句柄、OLE 或未知自定义格式在发送 `Ctrl+C` 之前拒绝；含有这些额外格式的复合剪贴板也可能被拒绝。恢复必须同时满足复制后的剪贴板序号及所属进程检查；快捷键无法确认选区时提示手动复制。

排除 LAT 自身窗口及能识别的密码控件，不提升管理员权限。某些高权限窗口受到 UIPI 限制，某些应用不暴露选区，扫描 PDF 无可选文字；这些情况允许明确提示手动复制或粘贴，不承诺所有 Windows 软件都能取词。

选区和推理留在本机。选区快照只用于当前会话，不记录页面 URL，不将原文写入诊断日志。原文作为内容显示，不执行其中的 HTML 或指令。只有用户开启历史保存且翻译完整成功时才持久化文本。

## 网关接口与兼容性

沿用 `POST /translate/stream` 和 `POST /translate/cancel`。浮窗请求示例：

```json
{
  "text": "A local translation example.",
  "source_language": "auto",
  "target_language": "Chinese",
  "require_ready": true
}
```

`require_ready` 为新增可选布尔值，省略或为 `false` 时保留旧的自动启动行为；为 `true` 时只允许使用已运行且健康的模型客户端。非布尔值返回请求错误。预检在输出 `plan` 前完成，各推理分段再次检查，避免中途关闭模型后被浮窗重新加载。

流式错误继续使用 HTTP 200 和 SSE，保留 `type`、`message`，增加稳定 `code`：

```json
{
  "type": "error",
  "message": "translation_busy: 模型正在处理另一个翻译任务，请稍后重试",
  "code": "translation_busy"
}
```

| 错误码 | 含义与浮窗行为 |
| --- | --- |
| `translation_busy` | 另一个任务占用模型；保留当前文字并允许重试，不取消原任务 |
| `model_not_ready` | 没有可用的已启用模型；提供前往主窗口启用的操作 |
| `checkpoint_expired` | 会话内断点不存在或已过期；重新发起翻译 |
| `checkpoint_mismatch` | 原文、语言、模型或推理配置与断点不一致；重新发起翻译 |
| `context_budget` | 配置不足以安排分段；展示错误 |
| `invalid_request`、`model_output_error`、`llama_runtime_error` | 其余请求、质量校验或运行时错误；保留原有详细消息 |

非流式接口保留已有 HTTP 状态和 `error.type`，只新增 `error.code`；例如忙碌仍为 400，准备阶段模型未启用为 503，分段执行失败仍为 502。已有 `/translate` 和 `/v1/chat/completions` 成功响应不变。

收到 `plan.job_id` 后，浮窗只使用该 ID 请求取消；尚未收到时关闭自己的连接。浮窗不会取消主窗口或其他任务。继续使用现有串行锁、分段保护、输出校验和会话内断点，不增加任务队列或第二个推理实例。

## 验证和交付

自动化覆盖取词状态、请求隔离、剪贴板恢复判断、浮窗状态、历史同步、网关就绪/忙碌/取消及旧接口兼容；完整版本检查和安装包构建按仓库要求执行。自动化测试不能替代浏览器选区、剪贴板和多显示器的真实桌面验收。

真实桌面操作仅在用户明确授权后执行；保留 beta.1 用户已填写的勾选与反馈，beta.2 新增复验项保持未勾选，见 [划词翻译验收清单](../acceptance/lat-selection-translation-checklist.md)。安装包和校验文件位于 `artifacts/v0.2.1-beta.2/`，不纳入 Git。完成本地提交后等待用户复验及单独发布指令，再推送和发布预发布版本。

需要检查鼠标取词链路时，可单独运行显式忽略的诊断测试：`cargo test --manifest-path src-tauri/Cargo.toml diagnose_desktop_selection -- --ignored --nocapture --test-threads=1`。默认监听 60 秒，可用 `LAT_SELECTION_DIAGNOSTIC_SECONDS` 调整；普通 `cargo test` 不执行它。诊断只输出阶段、布尔值、字符数及固定错误提示，不输出选中文本或窗口标题，也不模拟复制、调用模型或显示浮标。该诊断验证取词及浮标显示条件，实际 Tauri 浮标显示和点击须继续复验。

## 参考资料

- [Microsoft：IUIAutomationTextPattern::GetSelection](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationtextpattern-getselection)：文本选区的原生读取接口。
- [Microsoft：Understanding Threading Issues](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-threading)：桌面 UIA 客户端的线程与 COM apartment 要求。
- [Microsoft：SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)：模拟输入及 UIPI 限制。
- [selection-hook 项目说明](https://github.com/0xfullex/selection-hook#-how-it-works)：原生取词与复制兜底组合方案的参考实现。
