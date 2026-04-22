export function layoutModuleMasonry({ container, modules, addCard, mainCard }) {
  if (!container) {
    return;
  }

  const moduleCards = [...container.querySelectorAll(".module-card")];
  const cards = [...moduleCards];
  if (addCard) {
    cards.push(addCard);
  }

  if (!cards.length) {
    container.style.height = "0px";
    return;
  }

  const gap = 10;
  const containerWidth = Math.max(240, container.clientWidth);
  const minColumnWidth = 246;
  const columnCount = Math.max(1, Math.floor((containerWidth + gap) / (minColumnWidth + gap)));
  const columnWidth = Math.floor((containerWidth - gap * (columnCount - 1)) / columnCount);

  const columnHeights = new Array(columnCount).fill(0);

  let mainCardHeight = 0;

  if (mainCard) {
    const mainCardIndex = cards.indexOf(mainCard);
    if (mainCardIndex > -1) {
      cards.splice(mainCardIndex, 1);
    }

    mainCard.style.position = "absolute";
    mainCard.style.width = `${columnWidth}px`;
    mainCard.style.left = `0px`;
    mainCard.style.top = `0px`;

    mainCardHeight = mainCard.offsetHeight;
    columnHeights[0] += mainCardHeight + gap;
  }

  let currentColumn = 0;
  let lastModuleHeight = 0;

  cards.forEach((card) => {
    card.style.position = "absolute";
    card.style.width = `${columnWidth}px`;

    const cardHeight = card.offsetHeight;
    const isAddCard = card === addCard;

    // 没有任何模块时（仅剩 addCard），add-module-card 显示在第二列（Main 卡片右侧）
    if (isAddCard && cards.length === 1 && columnCount > 1) {
      currentColumn = 1;
      const left = currentColumn * (columnWidth + gap);
      const top = columnHeights[currentColumn];
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      columnHeights[currentColumn] += cardHeight + gap;
      return;
    }

    const isLastColumn = currentColumn === columnCount - 1;

    const judgeHeight = isAddCard ? lastModuleHeight : cardHeight;

    let shouldWrap = false;

    if (isLastColumn) {
      const shouldSkipToNextColumn = mainCardHeight > 0 && columnHeights[currentColumn] < mainCardHeight;

      if (shouldSkipToNextColumn) {
        currentColumn = 1;
        const left = currentColumn * (columnWidth + gap);
        const top = columnHeights[currentColumn];
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
        columnHeights[currentColumn] += cardHeight + gap;
        if (!isAddCard) {
          lastModuleHeight = cardHeight;
        }
        return;
      } else {
        const firstColumnHeight = columnHeights[0];
        const heightDiff = columnHeights[currentColumn] - firstColumnHeight;
        const shouldWrapByHeight = firstColumnHeight > columnHeights[currentColumn] + judgeHeight / 2;
        if (shouldWrapByHeight && (heightDiff <= 0 || judgeHeight <= 2 * heightDiff)) {
          shouldWrap = true;
        }
      }
    } else {
      const rightColumnHeight = columnHeights[currentColumn + 1];
      const heightDiff = columnHeights[currentColumn] - rightColumnHeight;
      const shouldWrapByHeight = rightColumnHeight > columnHeights[currentColumn] - judgeHeight / 2;
      if (shouldWrapByHeight && (heightDiff <= 0 || judgeHeight <= 2 * heightDiff)) {
        shouldWrap = true;
      }
    }

    if (!shouldWrap && !isLastColumn && !(isAddCard && lastModuleHeight === 0)) {
      currentColumn += 1;
    } else if (!shouldWrap && isLastColumn) {
      currentColumn = 0;
    }

    const left = currentColumn * (columnWidth + gap);
    const top = columnHeights[currentColumn];
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;

    columnHeights[currentColumn] += cardHeight + gap;

    if (!isAddCard) {
      lastModuleHeight = cardHeight;
    }
  });

  container.style.height = `${Math.max(...columnHeights) - gap}px`;
}
