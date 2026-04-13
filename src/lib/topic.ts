export function matchesTopicFilter(filter: string, topic: string) {
  const filterLevels = filter.split("/");
  const topicLevels = topic.split("/");

  for (let index = 0; index < filterLevels.length; index += 1) {
    const filterPart = filterLevels[index];
    const topicPart = topicLevels[index];

    if (filterPart === "#") {
      return true;
    }

    if (filterPart === "+") {
      continue;
    }

    if (filterPart !== topicPart) {
      return false;
    }
  }

  return filterLevels.length === topicLevels.length;
}
