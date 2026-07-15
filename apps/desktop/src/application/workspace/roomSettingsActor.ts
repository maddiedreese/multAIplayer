interface LocalUser {
  id: string;
  name: string;
}

export function createRoomSettingsActor(localUser: LocalUser) {
  return function roomSettingsActor() {
    return {
      requesterName: localUser.name,
      requesterUserId: localUser.id
    };
  };
}
