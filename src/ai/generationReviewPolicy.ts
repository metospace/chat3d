import type {SceneDocument} from '../domain/types';
import {visualReviewPlan} from '../domain/visualReviewPlan';

export function generationReviewPlan(base: SceneDocument, draft: SceneDocument, offset = 0, overviewOnly = false) {
  return {...visualReviewPlan(base, draft, offset, overviewOnly), coverage: 'component-multiview' as const, deferredDetailTargets: 0};
}
