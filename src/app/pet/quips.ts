/**
 * Pet "liveliness" engine — quips + small actions.
 *
 * Lifted (with permission, see plan §1) from the original Swift CodePet
 * by the same user — same cadence, same probability split, same lines.
 * The original code lives at ~/.codepet/CodePet.swift; we deliberately
 * mirror its feel rather than invent a new one.
 *
 * Cadence (per the Swift original, lines 161-205):
 *   working: drop a quip every 15-30s, show for 4.5s
 *   idle:    every 12-25s roll a 3-way dice —
 *              40% action only, 35% message only, 25% both
 *            action 1.8s (snore is 4.5s), message 5.0s
 *
 * State-conditional: working messages and idle messages are different
 * pools. Done / waiting are short transient states and don't trigger
 * quips on their own (the 5s done dwell handled by main process is
 * already its own visual punctuation).
 */

export type PetAction =
  | 'none'
  | 'stretch'
  | 'lookLeft'
  | 'lookRight'
  | 'hop'
  | 'sneeze'
  | 'peek'
  | 'snore';

export const IDLE_MESSAGES: readonly string[] = [
  '🐉 主人,要给我点活儿干嘛?',
  '💤 闲着也是闲着…',
  '✨ 摸鱼时光',
  '🍵 来杯茶不?',
  '🐾 嗷~',
  '💡 我有个有趣的主意…',
  '⏰ 该休息眼睛啦',
  '🌟 今天还顺利吗?',
  '🎯 给我布置个任务呗',
  '🍃 起风了…',
  '📖 翻翻记忆里的便签?',
  '🥚 我在等待新挑战',
  '🔮 占卜一下今天宜什么',
  '🎈 想出门散步了',
  '👀 我在看你哦',
  '🌈 今天也是元气满满~',
  '🐟 鱼丸粗面…',
  '🎵 哼哼哼哼~',
  '🍡 想吃点甜的',
  '📮 有你的小信件!(骗你的)',
  '🛌 困了想打个盹儿…',
  '☕️ 续个杯吧主人',
  '🪐 我在思考宇宙的奥秘',
  '🦋 一只蝴蝶飞过去了',
  '🎨 来画点什么吧',
  '🎮 偷偷玩一会儿?',
  '🌸 春天还远吗',
  '🍀 今天会有好事发生',
  '📚 看书时间到~',
  '💭 主人在想什么呢?',
];

export const WORKING_MESSAGES: readonly string[] = [
  '🔥 全力施工中!',
  '⚡️ 火力全开~',
  '🛠 别催别催,我在敲了',
  '🤖 嘀嘀嘀,处理中',
  '🧠 脑子转得飞起',
  '📝 先记下,回头办',
  '💪 这难不倒我!',
  '🎯 锁定目标,开整',
  '🚀 三、二、一,发射',
  '🌀 转得好快眼花',
  '🔧 拧个螺丝先',
  '✏️ 涂涂改改…',
  '🐍 蛇形走位中',
  '📦 打包打包',
  '🎪 看我表演',
  '🦾 机械臂启动',
  '🍜 等我搞完去吃面',
  '🧩 拼图拼一半别打扰',
  '💻 啪啪啪敲键盘',
  '🌪 别回头,专心就完事',
];

export const ALL_ACTIONS: readonly PetAction[] = [
  'stretch', 'lookLeft', 'lookRight', 'hop', 'sneeze', 'peek', 'snore',
];

export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Roll dice for idle behavior. Returns what to do next.
 * Mirrors Swift CodePet lines 184-207.
 */
export function rollIdleBehavior(): { action: PetAction; message: string | null } {
  const roll = Math.random();
  const doAction = roll < 0.65;
  const doMessage = roll >= 0.40;
  return {
    action: doAction ? pickRandom(ALL_ACTIONS) : 'none',
    message: doMessage ? pickRandom(IDLE_MESSAGES) : null,
  };
}

/** Action duration in ms. Snore is longer (sleep animation). */
export function actionDurationMs(action: PetAction): number {
  return action === 'snore' ? 4500 : 1800;
}

/** Random interval between idle dice rolls — 12-25s. */
export function nextIdleRollDelayMs(): number {
  return (12 + Math.random() * 13) * 1000;
}

/** Random interval between working quips — 15-30s. */
export function nextWorkingQuipDelayMs(): number {
  return (15 + Math.random() * 15) * 1000;
}

export const MESSAGE_DISPLAY_MS = 5000;
export const WORKING_MESSAGE_DISPLAY_MS = 4500;
