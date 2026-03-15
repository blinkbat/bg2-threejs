// =============================================================================
// CONSTRUCT CHARGE ATTACK BEHAVIOR - Initiates charge attacks
// =============================================================================

import { setSkillCooldown } from "../../combat/combatMath";
import { startChargeAttack } from "../constructCharge";
import type { ChargeContext } from "./types";

/**
 * Try to start a charge attack for an enemy with chargeAttack capability.
 * Handles cooldown check and initiates the charge.
 * @returns true if a charge was started
 */
export function tryStartChargeAttack(ctx: ChargeContext): boolean {
    const { unit, g, chargeAttack, scene, skillCooldowns, setSkillCooldowns, addLog, now } = ctx;

    const chargeKey = `${unit.id}-${chargeAttack.name}`;
    const chargeCooldownEnd = skillCooldowns[chargeKey]?.end ?? 0;

    if (now < chargeCooldownEnd) {
        return false;
    }

    // Start the charge attack
    startChargeAttack(scene, unit, g, chargeAttack, addLog);

    setSkillCooldown(setSkillCooldowns, chargeKey, chargeAttack.cooldown, now, unit);

    return true;
}
