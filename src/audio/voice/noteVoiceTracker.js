/**
 * 创建音符声音追踪器
 *
 * 用于跟踪多个声音（voices）当前正在播放哪些音符，
 * 实现了声音分配和释放的核心逻辑。
 *
 * @param {number} voiceCount - 声音数量（复音数）
 * @returns {Object} 包含分配、释放和状态查询方法的对象
 */
export function createNoteVoiceTracker(voiceCount) {
  /**
   * 声音状态数组
   *
   * 每个声音包含：
   * - note: 当前播放的音符（null 表示空闲）
   * - startTime: 开始播放的时间戳
   */
  const voiceStates = Array.from({ length: voiceCount }, () => ({
    note: null,
    startTime: 0,
  }));

  /**
   * 查找可用的声音索引
   *
   * 策略：
   * 1. 优先返回空闲的声音（note 为 null）
   * 2. 如果所有声音都在使用，则返回最早开始播放的声音（用于声音窃取）
   *
   * @returns {number} 可用声音的索引
   */
  const findAvailableVoice = () => {
    let oldest = null;
    let oldestIndex = -1;

    for (let i = 0; i < voiceStates.length; i++) {
      if (!voiceStates[i].note) {
        return i;
      }
      if (!oldest || voiceStates[i].startTime < oldest.startTime) {
        oldest = voiceStates[i];
        oldestIndex = i;
      }
    }
    return oldest ? oldestIndex : 0;
  };

  return {
    /**
     * 为指定音符分配一个声音
     *
     * @param {string} note - 音符名称（如 "C4"）
     * @param {number} time - 分配时间戳
     * @returns {number} 分配的声音索引
     */
    allocate(note, time) {
      const index = findAvailableVoice();
      voiceStates[index].note = note;
      voiceStates[index].startTime = time;
      return index;
    },

    /**
     * 根据音符释放对应的声音
     *
     * @param {string} note - 要释放的音符
     * @returns {number} 释放的声音索引，如果未找到返回 -1
     */
    releaseByNote(note) {
      const index = voiceStates.findIndex((item) => item.note === note);
      if (index < 0) {
        return -1;
      }
      voiceStates[index].note = null;
      return index;
    },

    /**
     * 清除所有声音状态
     *
     * 通常用于全部停止或重置。
     */
    clearAll() {
      voiceStates.forEach((item) => {
        item.note = null;
        item.startTime = 0;
      });
    },

    /**
     * 检查是否有活跃的音符正在播放
     *
     * @returns {boolean} 是否有活跃音符
     */
    hasActiveNotes() {
      return voiceStates.some((item) => item.note !== null);
    },
  };
}
