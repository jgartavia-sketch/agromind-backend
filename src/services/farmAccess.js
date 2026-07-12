// src/services/farmAccess.js

export async function assertFarmMember(prisma, farmId, userId) {
  return prisma.farmMember.findFirst({
    where: {
      farmId,
      userId,
      status: "ACTIVE",
    },
    select: {
      id: true,
      role: true,
      status: true,
      farm: {
        select: {
          id: true,
          name: true,
          view: true,
          preferredCenter: true,
        },
      },
    },
  });
}

export async function assertFarmAdmin(prisma, farmId, userId) {
  const member = await assertFarmMember(prisma, farmId, userId);

  if (!member) return null;
  if (member.role !== "ADMIN") return null;

  return member;
}

export async function assertZoneMember(prisma, zoneId, userId) {
  const zone = await prisma.mapZone.findUnique({
    where: { id: zoneId },
    select: {
      id: true,
      farmId: true,
    },
  });

  if (!zone) return null;

  const member = await assertFarmMember(prisma, zone.farmId, userId);

  if (!member) return null;

  return {
    ...member,
    zone,
  };
}

export async function assertProcessMember(prisma, processId, userId) {
  const process = await prisma.zoneProcess.findUnique({
    where: { id: processId },
    select: {
      id: true,
      zone: {
        select: {
          id: true,
          farmId: true,
        },
      },
    },
  });

  if (!process?.zone) return null;

  const member = await assertFarmMember(prisma, process.zone.farmId, userId);

  if (!member) return null;

  return {
    ...member,
    process,
  };
}

export async function assertTaskMember(prisma, taskId, userId) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      farmId: true,
    },
  });

  if (!task) return null;

  const member = await assertFarmMember(prisma, task.farmId, userId);

  if (!member) return null;

  return {
    ...member,
    task,
  };
}
