const code = value => String(value ?? '').trim().toLocaleLowerCase().replace(/^0+(?=\d)/, '');

export function buildingKey(room) {
  return `${String(room.campusCode ?? '')}/${code(room.buildingCode)}`;
}

export function roomBuildingLabel(room) {
  return room.eligibilityLabel || room.building || room.buildingCode;
}

function sameBuilding(a, b) {
  return String(a?.campusCode ?? '') === String(b?.campusCode ?? '') && code(a?.buildingCode) === code(b?.buildingCode);
}

function findCampusRule(policy, room) {
  return (policy?.campusRules || []).find(rule => String(rule.campusCode ?? '') === String(room.campusCode ?? ''));
}

function findAllowedBuilding(rule, room) {
  return rule?.allowedBuildings?.find(building => (building.buildingCodes || []).some(buildingCode => code(buildingCode) === code(room.buildingCode)));
}

function roomNumber(room) {
  return String(room.roomCode ?? room.name ?? '').trim().match(/^(\d+)/)?.[1] || '';
}

function findAllowedRoomSuffix(rule, room) {
  const number = roomNumber(room);
  if (number.length < 3) return null;
  return (rule?.allowedRoomNumberSuffixes || []).find(suffix => number.endsWith(String(suffix).padStart(2, '0'))) || null;
}

function findExplicitExclusion(policy, room) {
  return (policy?.excludedBuildings || []).find(building => sameBuilding(building, room));
}

function findNameExclusion(policy, room) {
  const names = [room.building, room.name, room.buildingCode].filter(Boolean).map(value => String(value));
  return (policy?.excludedBuildingNameIncludes || []).find(rule =>
    (!rule.campusCode || String(rule.campusCode) === String(room.campusCode ?? '')) &&
    names.some(name => name.includes(String(rule.text ?? '')))
  );
}

function pushUnmatched(unmatched, seen, entry) {
  const key = `${entry.kind}/${entry.campusCode}/${code(entry.buildingCode)}/${entry.label || ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  unmatched.push(entry);
}

export function applyAccessPolicy(rooms, policy = {}) {
  if (!Array.isArray(rooms)) throw new TypeError('rooms must be an array');
  const knownBuildings = new Set(rooms.map(buildingKey));
  const unmatchedBuildings = [];
  const unmatchedSeen = new Set();

  for (const rule of policy.campusRules || []) {
    for (const allowed of rule.allowedBuildings || []) {
      for (const buildingCode of allowed.buildingCodes || []) {
        const key = `${String(rule.campusCode ?? '')}/${code(buildingCode)}`;
        if (!knownBuildings.has(key)) pushUnmatched(unmatchedBuildings, unmatchedSeen, {
          kind: 'allowed',
          campusCode: String(rule.campusCode ?? ''),
          buildingCode: String(buildingCode),
          label: allowed.label || null
        });
      }
    }
  }
  for (const excluded of policy.excludedBuildings || []) {
    const key = `${String(excluded.campusCode ?? '')}/${code(excluded.buildingCode)}`;
    if (!knownBuildings.has(key)) pushUnmatched(unmatchedBuildings, unmatchedSeen, {
      kind: 'excluded',
      campusCode: String(excluded.campusCode ?? ''),
      buildingCode: String(excluded.buildingCode),
      label: null
    });
  }

  const mappedRooms = rooms.map(room => {
    const campusRule = findCampusRule(policy, room);
    const allowedBuilding = findAllowedBuilding(campusRule, room);
    const allowedRoomSuffix = findAllowedRoomSuffix(campusRule, room);
    const hasAllowList = Boolean(campusRule?.allowedBuildings?.length || campusRule?.allowedRoomNumberSuffixes?.length);
    const allowed = Boolean(allowedBuilding || allowedRoomSuffix);
    const explicitExclusion = findExplicitExclusion(policy, room);
    const nameExclusion = findNameExclusion(policy, room);
    if (explicitExclusion || nameExclusion) {
      return {
        ...room,
        candidateEligible: false,
        eligibilityNote: explicitExclusion?.reason || nameExclusion?.reason || '该地点暂不作为普通候选。',
        eligibilityLabel: null
      };
    }
    if (campusRule?.excludeOthers && hasAllowList && !allowed) {
      return {
        ...room,
        candidateEligible: false,
        eligibilityNote: campusRule.excludeReason || '该地点暂不作为普通候选。',
        eligibilityLabel: null
      };
    }
    return {
      ...room,
      candidateEligible: true,
      eligibilityNote: allowedBuilding?.note || (allowedRoomSuffix ? campusRule.allowedRoomNote || null : null),
      eligibilityLabel: allowedBuilding?.label || null
    };
  });

  return {rooms: mappedRooms, unmatchedBuildings};
}
