import type {Material} from './types';

export const PHYSICAL_MATERIAL_LIMITS = {
  clearcoat: [0, 1], clearcoatRoughness: [0, 1],
  transmission: [0, 1], thickness: [0, 100], ior: [1, 2.333],
  specularIntensity: [0, 1],
} as const;
export type PhysicalMaterialKey = keyof typeof PHYSICAL_MATERIAL_LIMITS;
export const PHYSICAL_MATERIAL_KEYS = Object.keys(PHYSICAL_MATERIAL_LIMITS) as PhysicalMaterialKey[];
export function physicalMaterialErrors(material: Partial<Material>): string[] {
  const errors = PHYSICAL_MATERIAL_KEYS.flatMap(key => {
    const value = material[key], [min, max] = PHYSICAL_MATERIAL_LIMITS[key];
    return value !== undefined && (!Number.isFinite(value) || value < min || value > max)
      ? [`材质 ${key} 需为 ${min}–${max}`] : [];
  });
  if(material.specularColor!==undefined&&!/^#[0-9a-f]{6}$/i.test(material.specularColor))errors.push('材质 specularColor 不是合法 hex 颜色');
  return errors;
}
