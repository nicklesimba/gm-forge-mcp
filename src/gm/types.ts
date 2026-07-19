/**
 * Additional types for GameMaker resources
 */

export interface EventDefinition {
  eventType: number;
  eventNum: number;
  // For Collision events (eventType 4): the other object's name. Resolved
  // against a real, existing object -- collisionObjectId is a {name,path}
  // reference like any other, not a bare number.
  collisionTargetName?: string;
}

export interface ResourceReference {
  id: {
    name: string;
    path: string;
  };
}

