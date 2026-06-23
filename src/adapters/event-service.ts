/**
 * Event Service Interface
 *
 * Abstraction for domain event emission.
 * NoOp default does nothing — host agent can provide
 * a real implementation for observability.
 */

import type { DomainEvent } from '../persistence/interfaces/event.repository.js';

export interface EventService {
  emit(event: DomainEvent): void;
}

export class NoOpEventService implements EventService {
  emit(_event: DomainEvent): void {
    // intentionally empty
  }
}
