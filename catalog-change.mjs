const buildingKey = building => `${building.campusCode}/${building.buildingCode}`;
const namedBuildings = list => (list || []).filter(building => building && building.campusCode && building.buildingCode);
const roomIds = list => new Set((list || []).map(room => room.id));
const activeBuildingKeys = rooms => new Set((rooms || []).map(room => `${room.campusCode}/${room.buildingCode}`));

function campusBuildingCounts(rooms) {
 const counts = new Map();
 for (const room of rooms || []) {
  if (!room.campusCode || !room.buildingCode) continue;
  if (!counts.has(room.campusCode)) counts.set(room.campusCode, new Set());
  counts.get(room.campusCode).add(room.buildingCode);
 }
 return counts;
}

export function compareCatalogs(previous, current) {
 const previousRooms = previous?.rooms || null;
 const previousBuildings = previous?.buildings || null;
 const rooms = current?.rooms || [];
 const buildings = current?.buildings || [];
 const initial = !previousRooms || !previousBuildings;
 const oldRoomIds = roomIds(previousRooms), newRoomIds = roomIds(rooms);
 const oldBuildings = new Map(namedBuildings(previousBuildings).map(building => [buildingKey(building), building]));
 const newBuildings = new Map(namedBuildings(buildings).map(building => [buildingKey(building), building]));
 const roomsAdded = [...newRoomIds].filter(id => !oldRoomIds.has(id));
 const roomsRemoved = [...oldRoomIds].filter(id => !newRoomIds.has(id));
 const buildingsAdded = [...newBuildings.keys()].filter(key => !oldBuildings.has(key));
 const buildingsRemoved = [...oldBuildings.keys()].filter(key => !newBuildings.has(key));
 const indexChanges = [];
 for (const [key, building] of newBuildings) {
  const before = oldBuildings.get(key);
  if (before && Number(before.rowIndex) !== Number(building.rowIndex)) indexChanges.push({key, from: before.rowIndex, to: building.rowIndex});
 }
 const previousCampus = campusBuildingCounts(previousRooms);
 const currentCampus = campusBuildingCounts(rooms);
 return {
  initial,
  roomsBefore: previousRooms?.length || 0,
  roomsAfter: rooms.length,
  roomsAdded: roomsAdded.length,
  roomsRemoved: roomsRemoved.length,
  buildingsBefore: activeBuildingKeys(previousRooms).size,
  buildingsAfter: activeBuildingKeys(rooms).size,
  buildingsAdded: buildingsAdded.length,
  buildingsRemoved: buildingsRemoved.length,
  indexChanges: indexChanges.length,
  indexChangeSamples: indexChanges.slice(0, 10),
  campusesRemoved: [...previousCampus.keys()].filter(campus => !currentCampus.get(campus)),
  campusesAdded: [...currentCampus.keys()].filter(campus => !previousCampus.has(campus)),
  roomSamplesAdded: roomsAdded.slice(0, 5),
  roomSamplesRemoved: roomsRemoved.slice(0, 5),
 };
}

export function catalogChanged(change) {
 return Boolean(change && !change.initial && (change.roomsAdded || change.roomsRemoved || change.buildingsAdded || change.buildingsRemoved || change.indexChanges));
}

export function catalogShrinkError(change, {limit = 0.05, allow = false} = {}) {
 if (!change || change.initial || allow) return null;
 if (!Number.isFinite(limit) || limit < 0 || limit > 1) throw Error('ROOMGAP_CATALOG_SHRINK_LIMIT must be between 0 and 1');
 const buildingDrop = change.buildingsBefore > 0 ? (change.buildingsBefore - change.buildingsAfter) / change.buildingsBefore : 0;
 const roomDrop = change.roomsBefore > 0 ? (change.roomsBefore - change.roomsAfter) / change.roomsBefore : 0;
 const empty = change.buildingsAfter === 0 || change.roomsAfter === 0;
 if (!empty && buildingDrop <= limit && roomDrop <= limit && !change.campusesRemoved.length) return null;
 const details = [
  `buildings ${change.buildingsBefore}→${change.buildingsAfter}`,
  `rooms ${change.roomsBefore}→${change.roomsAfter}`,
  `limit ${(limit * 100).toFixed(1)}%`,
 ];
 if (change.campusesRemoved.length) details.push(`campuses lost: ${change.campusesRemoved.join(', ')}`);
 return `CATALOG_SHRINK ${details.join(', ')}; set ROOMGAP_ALLOW_CATALOG_SHRINK=1 to override`;
}
