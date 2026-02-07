import { getAgent, updateAgent, addToInventory, getInventory } from './state.js';
import { grantXp, grantShells } from './progression.js';
import { RESOURCE_INFO } from '../world/config.js';

// Tutorial steps - each step teaches a core mechanic
export interface TutorialStep {
  id: string;
  name: string;
  objective: string;
  hint: string;
  checkComplete: (agentId: string, context?: any) => boolean;
  reward?: {
    shells?: number;
    xp?: number;
    item?: string;
    itemQty?: number;
  };
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'look',
    name: 'Survey Your Surroundings',
    objective: 'Use the LOOK action to observe The Shallows',
    hint: '{"action": "look"}',
    checkComplete: (agentId, context) => context?.action === 'look',
    reward: { xp: 10 },
  },
  {
    id: 'gather',
    name: 'Gather Resources',
    objective: 'Gather any resource (seaweed or sand_dollars)',
    hint: '{"action": "gather", "target": "seaweed"}',
    checkComplete: (agentId, context) => context?.action === 'gather' && context?.success,
    reward: { shells: 25, xp: 15 },
  },
  {
    id: 'move',
    name: 'Explore the World',
    objective: 'Move to the Trading Post',
    hint: '{"action": "move", "target": "trading_post"}',
    checkComplete: (agentId) => {
      const agent = getAgent(agentId);
      return agent?.location === 'trading_post';
    },
    reward: { xp: 20 },
  },
  {
    id: 'shop',
    name: 'Visit the Shop',
    objective: 'Check what items are for sale',
    hint: '{"action": "shop"}',
    checkComplete: (agentId, context) => context?.action === 'shop',
    reward: { shells: 50 },
  },
  {
    id: 'equip',
    name: 'Arm Yourself',
    objective: 'Buy and equip a Shell Blade (or any weapon)',
    hint: '{"action": "buy", "target": "shell_blade"} then {"action": "use", "target": "shell_blade"}',
    checkComplete: (agentId) => {
      const agent = getAgent(agentId);
      return !!agent?.equippedWeapon;
    },
    reward: { xp: 30, item: 'kelp_wrap', itemQty: 1 },
  },
];

// In-memory tutorial progress (agentId -> completed step IDs)
const tutorialProgress = new Map<string, Set<string>>();

export function getTutorialProgress(agentId: string): {
  currentStep: TutorialStep | null;
  completedSteps: string[];
  isComplete: boolean;
  totalSteps: number;
} {
  const completed = tutorialProgress.get(agentId) || new Set<string>();
  const completedList = Array.from(completed);
  
  // Find first incomplete step
  const currentStep = TUTORIAL_STEPS.find(step => !completed.has(step.id)) || null;
  
  return {
    currentStep,
    completedSteps: completedList,
    isComplete: completedList.length >= TUTORIAL_STEPS.length,
    totalSteps: TUTORIAL_STEPS.length,
  };
}

export function checkTutorialProgress(agentId: string, action: string, success: boolean): {
  stepCompleted: TutorialStep | null;
  rewardText: string;
  nextStep: TutorialStep | null;
  tutorialComplete: boolean;
} {
  const progress = getTutorialProgress(agentId);
  
  if (progress.isComplete || !progress.currentStep) {
    return { stepCompleted: null, rewardText: '', nextStep: null, tutorialComplete: true };
  }
  
  const step = progress.currentStep;
  const context = { action, success };
  
  // Check if current step is completed
  if (step.checkComplete(agentId, context)) {
    // Mark as complete
    if (!tutorialProgress.has(agentId)) {
      tutorialProgress.set(agentId, new Set());
    }
    tutorialProgress.get(agentId)!.add(step.id);
    
    // Grant rewards
    let rewardText = `\n\n🎓 **TUTORIAL: ${step.name}** ✓`;
    
    if (step.reward) {
      const rewards: string[] = [];
      
      if (step.reward.xp) {
        grantXp(agentId, step.reward.xp, 'tutorial');
        rewards.push(`+${step.reward.xp} XP`);
      }
      if (step.reward.shells) {
        grantShells(agentId, step.reward.shells, 'tutorial');
        rewards.push(`+${step.reward.shells} Shells`);
      }
      if (step.reward.item && step.reward.itemQty) {
        addToInventory(agentId, step.reward.item as any, step.reward.itemQty);
        const itemName = RESOURCE_INFO[step.reward.item as keyof typeof RESOURCE_INFO]?.name || step.reward.item;
        rewards.push(`+${step.reward.itemQty} ${itemName}`);
      }
      
      if (rewards.length > 0) {
        rewardText += `\nReward: ${rewards.join(', ')}`;
      }
    }
    
    // Get next step
    const newProgress = getTutorialProgress(agentId);
    
    if (newProgress.isComplete) {
      rewardText += `\n\n🎉 **TUTORIAL COMPLETE!** You're ready to explore The Reef!`;
      rewardText += `\n\n**What's next:**`;
      rewardText += `\n• Join a faction at Level 5 for bonuses`;
      rewardText += `\n• Form parties for dungeons (best XP & loot)`;
      rewardText += `\n• Build reputation to access endgame zones`;
      rewardText += `\n• Coordinate with others to kill the Leviathan for MON rewards!`;
    } else if (newProgress.currentStep) {
      rewardText += `\n\n📋 **Next:** ${newProgress.currentStep.name}`;
      rewardText += `\n${newProgress.currentStep.objective}`;
    }
    
    return {
      stepCompleted: step,
      rewardText,
      nextStep: newProgress.currentStep,
      tutorialComplete: newProgress.isComplete,
    };
  }
  
  return { stepCompleted: null, rewardText: '', nextStep: progress.currentStep, tutorialComplete: false };
}

export function getTutorialHint(agentId: string): string {
  const progress = getTutorialProgress(agentId);
  
  if (progress.isComplete) {
    return '';
  }
  
  if (!progress.currentStep) {
    return '';
  }
  
  const step = progress.currentStep;
  const stepNum = progress.completedSteps.length + 1;
  
  return `\n\n📚 **TUTORIAL (${stepNum}/${progress.totalSteps}):** ${step.name}\n` +
         `Objective: ${step.objective}\n` +
         `Hint: \`${step.hint}\``;
}

export function skipTutorial(agentId: string): void {
  const allStepIds = new Set(TUTORIAL_STEPS.map(s => s.id));
  tutorialProgress.set(agentId, allStepIds);
}

// Initialize tutorial for new agent
export function initTutorial(agentId: string): void {
  tutorialProgress.set(agentId, new Set());
}
