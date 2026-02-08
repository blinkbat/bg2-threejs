// =============================================================================
// CORRUPT DRUID VINES BEHAVIOR - Immobilizing vine attack
// =============================================================================

import * as THREE from "three";
import { getUnitStats } from "../../game/units";
import { distance } from "../../game/geometry";
import { soundFns } from "../../audio";
import { setSkillCooldown } from "../../combat/combatMath";
import { BUFF_TICK_INTERVAL, COLORS } from "../../core/constants";
import { applyDamageToUnit, type DamageContext } from "../../combat/damageEffects";
import type { VinesContext } from "./types";

// =============================================================================
// VINES SKILL
// =============================================================================

/**
 * Try to cast vines on a target, immobilizing them.
 * @returns true if vines were cast
 */
export function tryVinesSkill(ctx: VinesContext): boolean {
    const {
        unit, g, enemyStats, vinesSkill, targetUnit, targetG, scene,
        skillCooldowns, setSkillCooldowns, setUnits, addLog, now,
        damageTexts, hitFlashRef, unitsRef, unitsStateRef, defeatedThisFrame
    } = ctx;

    const vinesKey = `${unit.id}-vines`;
    const vinesCooldownEnd = skillCooldowns[vinesKey]?.end ?? 0;

    if (now < vinesCooldownEnd) {
        return false;
    }

    // Check distance to target
    const dist = distance(targetG.position.x, targetG.position.z, g.position.x, g.position.z);

    // Only cast if target is within range
    if (dist > vinesSkill.range) {
        return false;
    }

    // Don't cast on already pinned targets
    if (targetUnit.statusEffects?.some(e => e.type === "pinned")) {
        return false;
    }

    // Apply pinned status effect
    setUnits(prev => prev.map(u => {
        if (u.id !== targetUnit.id) return u;
        const newEffects = [...(u.statusEffects || [])];
        newEffects.push({
            type: "pinned",
            duration: vinesSkill.duration,
            tickInterval: BUFF_TICK_INTERVAL,
            timeSinceTick: 0,
            lastUpdateTime: now,
            damagePerTick: 0,
            sourceId: unit.id
        });
        return { ...u, statusEffects: newEffects };
    }));

    // Calculate and apply damage using centralized damage system
    const damage = vinesSkill.damage[0] + Math.floor(Math.random() * (vinesSkill.damage[1] - vinesSkill.damage[0] + 1));
    const targetData = getUnitStats(targetUnit);
    const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, unitsStateRef, setUnits, addLog, now, defeatedThisFrame };
    applyDamageToUnit(dmgCtx, targetUnit.id, targetG, targetUnit.hp, damage, targetData.name, {
        color: COLORS.damageEnemy,
        hitMessage: { text: `${enemyStats.name} entangles ${targetUnit.team === "player" ? "a party member" : "its target"} in vines for ${damage} damage!`, color: "#2d4a1c" },
        targetUnit
    });

    // Create visual effect - green vines rising from ground
    createVinesEffect(scene, targetG.position.x, targetG.position.z, vinesSkill.duration);

    // Play sound
    soundFns.playVines();

    setSkillCooldown(setSkillCooldowns, vinesKey, vinesSkill.cooldown, now, unit);

    return true;
}

// =============================================================================
// VISUAL EFFECTS
// =============================================================================

/**
 * Create a visual effect for vines at the target location.
 */
function createVinesEffect(scene: THREE.Scene, x: number, z: number, duration: number): void {
    const vinesGroup = new THREE.Group();
    vinesGroup.position.set(x, 0, z);

    // Create several vine tendrils
    const vineColor = 0x2d5a1c;
    const vineMaterial = new THREE.MeshBasicMaterial({ color: vineColor });
    const geometries: THREE.BufferGeometry[] = [];

    for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const vineGeom = new THREE.CylinderGeometry(0.05, 0.08, 1.2, 6);
        geometries.push(vineGeom);
        const vine = new THREE.Mesh(vineGeom, vineMaterial);
        vine.position.set(Math.cos(angle) * 0.4, 0.6, Math.sin(angle) * 0.4);
        vine.rotation.x = Math.sin(angle) * 0.3;
        vine.rotation.z = Math.cos(angle) * 0.3;
        vinesGroup.add(vine);
    }

    // Add a base ring
    const ringGeom = new THREE.TorusGeometry(0.5, 0.1, 8, 16);
    geometries.push(ringGeom);
    const ring = new THREE.Mesh(ringGeom, vineMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    vinesGroup.add(ring);

    scene.add(vinesGroup);

    // Animate and remove after duration
    const startTime = performance.now();
    const animate = () => {
        const elapsed = performance.now() - startTime;
        const progress = elapsed / duration;

        if (progress >= 1) {
            scene.remove(vinesGroup);
            geometries.forEach(g => g.dispose());
            vineMaterial.dispose();
            return;
        }

        // Fade out near the end
        if (progress > 0.8) {
            const fadeProgress = (progress - 0.8) / 0.2;
            vineMaterial.opacity = 1 - fadeProgress;
            vineMaterial.transparent = true;
        }

        // Gentle sway
        vinesGroup.rotation.y = Math.sin(elapsed / 200) * 0.1;

        requestAnimationFrame(animate);
    };
    animate();
}
