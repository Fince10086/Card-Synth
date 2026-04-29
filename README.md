# Card Synth

## 简介

Card Synth 是一款基于 Web 的模块化合成器，采用直观的卡片式界面，让你像搭积木一样组合声音模块，创造丰富的音色并用手势进行即兴表演。

---

## 快速开始

### 安装与运行

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建生产版本
npm run build
```

打开浏览器访问 `http://localhost:5173`（或控制台显示的地址）。

### 首次使用

1. **启动音频**: 点击界面任意位置或按下键盘，浏览器会请求音频权限，点击允许。
2. **弹奏音符**: 使用屏幕虚拟键盘、电脑键盘或 MIDI 键盘演奏。
3. **调节声音**: 拖动模块卡片上的滑块实时改变音色。
4. **添加模块**：点击加号以添加新的模块。

---

## 界面概览

### 主控制面板 (Main Card)

位于界面最左侧的主卡片包含全局控制：

- **Chain 切换** (I / II / III / IV): 点击罗马数字切换当前编辑的信号链。灰色表示该链已禁用。
- **Preset 预设**: 选择内置预设快速切换音色。
- **Master Volume**: 主音量控制。
- **Velocity**: 力度开关，开启后音符响度会随按键力度变化。
- **示波器/频谱**: 实时显示音频波形或频谱。
- **宏控制面板**: XY 轴宏控制器，可绑定到任意模块参数。

### 信号流区域 (Signal Flow)

中央区域显示当前链的所有模块，信号从左到右流动，模块可以放在任意位置：

```
[输入] → [源] → [效果] → [输出]
```

以下是另一种同样可能的情况：

```
[输入] → [源] → [效果] → [源] → [输入] → [源] → [效果] → [输出]
```

**模块连接规则**：
- **Input** 模块不参与音频信号连接，只控制其后 Source 和 Envelope 的触发
- **Source** 模块不会接收先于它的模块的输出（遇到 Source 时信号自动跳过）
- **Effect** 放在 Source 之前不会对该 Source 生效

### 模块卡片

每个模块以卡片形式呈现，包含：
- **模块标题**: 显示模块类型名称
- **启用开关**: 左上角切换模块是否参与音频处理
- **参数控制**: 滑块、下拉菜单、开关等
- **调制模式** (源模块/包络模块): 切换后该模块可作为调制源

---

## 模块类型

### 输入模块 (Input) [绿色]

输入模块控制链中 Source 和 Envelope 的触发方式，每个模块独立工作：

| 模块 | 说明 | 关键参数 |
|------|------|----------|
| **Pitch** | 音高计算与变换 | Transpose(移调), Octave(八度), Mode(MIDI/固定频率), Frequency(频率) |
| **Voices** | Voice 分配管理 | Mono(单音)/Poly(复音) |
| **Pedal** | 延音踏板控制 | Pedal(开关) |

#### Voice 分配系统（Note-Centric）

**Voices** 模块是链中唯一的 Voice 分配器，采用 **Note-Centric** 设计：

- **Note 状态与 Voice 分离**：每个 note 有独立的 `pressed`/`stolen`/`pendingRelease` 状态
- **Voice Stealing 带恢复**：当 voice 不足时，新 note 会 steal 最旧的 voice，但被 steal 的 note 只要按键还按着就会进入 **stolen 状态**，等待 voice 空闲后自动恢复
- **硬 Release + 重新 Attack**：steal 发生时，被 steal 的 note 立即执行完整 envelope release，新 note 重新触发 attack

**Steal & Recovery 示例**（Poly=2）：
```
按下 C4 → Voice 0 (C4)
按下 E4 → Voice 1 (E4)  
按下 G4 → Steal Voice 0 from C4 → Voice 0 (G4), C4 进入 stolen 状态
松开 G4 → Release Voice 0 → **自动恢复 C4 到 Voice 0** → 重新触发 C4 attack
松开 C4 → Release Voice 0
```

如果没有显式添加 Voices 模块，链的开头会自动创建一个**隐藏的 Voices**（默认 Poly 模式）。

#### Pitch 控制范围

每个 Pitch 模块独立控制其后直到**下一个 Pitch 模块**之前的 Source 和 Envelope：

```
Pitch A → Oscillator → Filter → Pitch B → Oscillator → Envelope
  ↑                        ↑         ↑                        ↑
控制范围 A               控制范围 A   控制范围 B                控制范围 B
```

#### Mono/Poly 行为

Source 根据**最近的 Voices 配置**决定 Mono/Poly：

```
Pitch → Oscillator → Voices=Mono → Oscillator → Envelope
        ↑                    ↑
     Poly (复音)        Mono (单音)
```

- 第一个 Oscillator = Poly（使用全局复音数）
- 第二个 Oscillator = Mono（所有音符共享同一个 voice）
- Envelope = Mono（跟随第二个 Oscillator 的配置）

如果没有显式添加 Pitch 模块，链的开头会自动创建一个**隐藏的 Pitch**（默认 MIDI 模式）。

### 源模块 (Source) [青色]

产生原始音频信号的模块：

| 模块 | 说明 | 关键参数 |
|------|------|----------|
| **Oscillator** | 基础振荡器 | Wave(波形), Detune(失谐) |
| **PulseOscillator** | 脉冲波振荡器 | Width(脉宽), Detune(失谐) |
| **Noise** | 噪声发生器 | Color(颜色: White/Pink/Brown), Rate(速率) |
| **Player** | 采样播放器 | Root(根音), Rate(播放速率), Loop(循环) |

### 包络模块 (Envelope)

控制音量或作为调制源的包络模块：

| 模式 | 说明 | 颜色 | 在信号链中 |
|------|------|------|------------|
| **非调制模式** (默认) | 振幅包络，控制音量 | 金色 | 处理音频 |
| **调制模式** | 通用包络，输出调制信号 | 蓝色 | 不处理音频，通过调制连线控制其他参数 |

### 效果模块 (Effect) [红色]

为声音添加空间感和色彩，以及处理音频信号的模块：

| 模块 | 说明 | 关键参数 |
|------|------|----------|
| **Filter** | 滤波器 | Type(类型), Frequency(频率), Q(共振) |
| **Compressor** | 压缩器 | Threshold, Ratio, Attack, Release |
| **Gain** | 增益 | Gain(增益量) |
| **EQ3** | 三段均衡 | Low, Mid, High |
| **Chorus** | 合唱效果 | Frequency, Depth, Delay Time |
| **Reverb** | 混响 | Decay(衰减), PreDelay(预延迟), Wet(干湿比) |
| **AutoFilter** | 自动滤波 | Frequency, Depth, Base Frequency |
| **Delay** | 延迟 | Delay Time, Feedback, Wet |
| **Distortion** | 失真 | Distortion(失真度), Wet |
| **Phaser** | 相位器 | Frequency, Depth, Stages |
| **Tremolo** | 颤音 | Frequency, Depth, Waveform |
| **Vibrato** | 颤音(音高) | Frequency, Depth, Waveform |
等等

---

## 基本操作

### 添加模块

点击信号流区域左侧的 **+** 按钮，在下拉菜单中选择模块类型和具体模块。

### 删除模块

点击模块卡片右上角的 **×** 按钮移除该模块。

### 重排模块

按住模块卡片的标题栏拖动，可以改变模块在信号链中的顺序。模块可以放在任意位置。

### 启用/禁用模块

点击模块左上角的小圆点，可以快速启用或禁用该模块，方便对比效果。

### 调节参数

- **滑块**: 水平拖动调节数值，支持精细调节。
- **下拉菜单**: 点击选择不同的模式或类型。
- **开关**: 点击切换开关状态。

---

## 高级功能

### 调制系统 (Modulation)

调制允许一个模块的输出控制另一个模块的参数，创造动态变化的声音。

#### 建立调制连接

1. **设置调制源**: 点击源模块（如 Oscillator）上的 **MOD** 按钮，开启调制模式。
2. **拖拽连接**: 按住源模块右侧出现的调制输出点，拖动到目标模块的参数滑块上。
3. **调节深度**: 连接建立后，会出现深度滑块控制调制强度。

#### 支持的调制源

- **Envelope**: 开启 MOD 模式后的包络模块。
- **Source 模块**: 开启 MOD 模式后的 Oscillator、Noise 等。

#### 删除调制连接

点击调制连线或深度滑块旁的删除按钮。

### 宏控制 (Macro)

宏控制允许你用一个 XY(Z) 控制器同时影响多个参数。

#### 绑定宏到参数

1. 在主面板的宏区域，选择一个轴（X、Y 或 Z）。
2. 点击该轴的绑定按钮（或从轴上拖拽）。
3. 将连接线拖到目标模块的参数滑块上释放。
4. 设置该参数在宏控制下的变化范围。

#### 使用宏

- **XY 面板**: 在主卡片的宏区域拖动圆点，同时改变所有绑定的参数。
- **精确控制**: 每个轴都有独立的数值显示。

#### 清除绑定

点击宏轴的清除按钮，或手动调节已绑定的参数（会自动解除绑定）。

### 手势控制

通过摄像头捕捉手部动作来控制合成器。

#### 启用手势

点击主面板上的 **Gesture** 按钮，允许摄像头访问。

#### 手势映射

- **左手捏合**: 控制最近链的增益（上下移动改变音量）。
- **右手捏合**: 控制最近链在 XY 空间的位置。
- **双手 X 手势**: 禁用当前链。

#### 视觉反馈

覆盖层会显示手部关键点、控制点位置以及当前帧率。

---

## 输入方式

### 虚拟键盘

界面底部的屏幕键盘支持鼠标/触摸点击演奏。

### 电脑键盘

使用以下键位映射（默认以 C 大调白键为主）：

```
  W   E       T   Y   U       O   P
 A   S   D   F   G   H   J   K   L   ;   '
```

- **Z / X**: 八度降低/升高（仅影响电脑键盘和虚拟键盘的输入）
- **C / V**: 力度降低/升高（仅影响电脑键盘和虚拟键盘的输入）
- **N / M**: 切换到前一条/后一条链

### MIDI 键盘

1. 连接 MIDI 设备到电脑。
2. 点击主面板的 **MIDI** 按钮。
3. 从下拉菜单选择 MIDI 输入设备。
4. 直接弹奏 MIDI 键盘即可控制合成器。

**注意**：MIDI 键盘的输入不受 Z/X 键的八度控制影响，八度/移调由链中的 **Pitch 模块**控制。

---

## 预设管理

### 导入预设

点击主面板上的 **Import** 按钮，选择 `.json` 格式的预设文件。

### 导出预设

- **Export Current**: 导出当前选中的链的预设。
- **Export All**: 导出所有 4 条链的完整预设。

### 预设文件格式

预设文件为 JSON 格式，包含：
- `global`: 全局设置（音量、力度、复音数）
- `chains`: 多条链的状态
  - `modules`: 模块列表及其参数
  - `modulations`: 调制连接
- `macro`: 宏控制绑定

模块字段说明：
- `category`: 模块类别 (`input`, `source`, `component`, `effect`)
- `type`: 模块类型
- `modulationMode`: 是否为调制模式（Source 和 Envelope 模块）
- `options`: 模块参数

---

## 信号流与多链工作

### 4 条并行链

Card Synth 支持 4 条独立的信号链（I、II、III、IV），每条链可以拥有完全不同的模块配置：

- 点击罗马数字切换当前编辑的链。
- 可以同时启用多条链，它们的输出会混合在一起。
- 每条链都有自己的宏控制状态。

### 信号路由

```
Chain I  ──┐
Chain II ──┼──> Master Volume ──> Limiter ──> Output
Chain III ─┤
Chain IV ──┘
```

---

## 故障排除

### 没有声音

1. **检查音频上下文**: 确保点击了界面以启动音频（浏览器安全策略要求用户交互）。
2. **检查主音量**: 确认 Master Volume 不是静音状态。
3. **检查模块启用状态**: 确保源模块和必要的处理模块已启用。
4. **检查链状态**: 确认当前链已启用（罗马数字按钮不是灰色）。

### MIDI 无法连接

1. 确认浏览器支持 Web MIDI（Chrome/Edge 通常支持）。
2. 检查 MIDI 设备是否正确连接并被系统识别。
3. 尝试重新插拔 MIDI 设备后点击 MIDI 按钮刷新。

### 手势控制不工作

1. 确认浏览器允许摄像头访问。
2. 确保光线充足，手部在摄像头视野内。
3. 检查 MediaPipe 模型是否加载完成（首次使用需要下载模型）。

---

## 键盘快捷键汇总

| 快捷键 | 功能 |
|--------|------|
| `A` - `'` | 演奏音符（虚拟钢琴键） |
| `Z` | 八度 -1 |
| `X` | 八度 +1 |
| `C` | 力度减小 |
| `V` | 力度增大 |

---

## 开发信息

**项目结构**:
```
src/
  app/           # 主应用逻辑
  audio/         # 音频引擎 (Tone.js)
    runtimes/    # 模块运行时
      sourceRuntime.js      # 源模块运行时（支持动态 Mono/Poly）
      envelopeRuntime.js    # 统一包络运行时（振幅/调制双模式）
      inputRuntime.js       # 输入模块运行时（Voices/Pitch/Pedal 独立）
      effectRuntime.js      # 效果模块运行时
    chain/         # 信号链连接
      signalChain.js        # 音频信号路由
    voice/         # 声部管理
      noteVoiceTracker.js   # 音符到声部映射
  core/          # 核心库、键盘映射、采样、模块定义
  input/         # 输入管理 (键盘、MIDI)
  interactions/  # 交互系统 (调制、宏、手势、拖拽)
  preset/        # 预设管理
  ui/            # UI 组件、控件、布局
  utils/         # 工具函数
```

**技术栈**:
- [Vite](https://vitejs.dev/) - 构建工具
- [Tone.js](https://tonejs.github.io/) - Web 音频框架
- [MediaPipe Tasks Vision](https://developers.google.com/mediapipe) - 手势识别
