interface LocalUser {
  id: string;
  name: string;
}

export function useRoomSettingsActor(localUser: LocalUser) {
  return function roomSettingsActor() {
    return {
      requesterName: localUser.name,
      requesterUserId: localUser.id
    };
  };
}
