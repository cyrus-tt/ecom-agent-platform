"use strict";

const DEFAULT_SKILL_ID = "exec_summary";

const SKILLS = [
  {
    id: "exec_summary",
    name: "经营总览",
    description: "面向管理层的摘要，聚焦核心指标变化和最重要的行动项。",
    prompt:
      "请优先输出高层可读摘要，围绕 GMV、销量、折扣率、售罄率和结构变化，提炼 3 条最重要的经营动作，并给出优先级。",
  },
  {
    id: "structure_followup",
    name: "结构跟进",
    description: "重点看商品结构偏差、趋势变化和需要下钻跟进的对象。",
    prompt:
      "请重点识别 GMV 占比与库存占比的偏差，把结构偏差和趋势变化结合分析，明确哪些品类需要继续下钻到 Top 款，并给出补货、调拨、加推、降推或改价建议。",
  },
  {
    id: "inventory_risk",
    name: "库存风险",
    description: "识别缺货、积压和入库承接问题，输出风险清单。",
    prompt:
      "请重点识别缺货风险、库存承压和计划承接风险，区分高优先级与观察项，并给出补货、调拨、降推、改价、下架等动作建议。",
  },
  {
    id: "trend_diagnosis",
    name: "增长机会",
    description: "强调上升/下降趋势背后的驱动因素和增长抓手。",
    prompt:
      "请重点分析上升品类、下降品类及其可能驱动，区分短期波动和持续趋势，给出可验证的增长机会、资源倾斜建议和风险提示。",
  },
];

function getSkillById(skillId) {
  const target = String(skillId || "").trim();
  return SKILLS.find((item) => item.id === target) || SKILLS[0];
}

function listSkills() {
  return SKILLS.map((item) => ({ ...item }));
}

function resolveSkillPrompt(skillId, promptText) {
  const skill = getSkillById(skillId);
  const prompt = String(promptText || "").trim() || skill.prompt;
  return {
    skill_id: skill.id,
    skill_name: skill.name,
    prompt_text: prompt,
  };
}

module.exports = {
  DEFAULT_SKILL_ID,
  getSkillById,
  listSkills,
  resolveSkillPrompt,
};
