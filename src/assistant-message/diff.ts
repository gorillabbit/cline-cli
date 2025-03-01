/**
 * 与えられた検索コンテンツに対して、オリジナルコンテンツ内で行ごとにトリムしたフォールバックマッチを試みます。
 * `searchContent` の各行と、`originalContent` の `startIndex` 以降の行ブロックを比較し、
 * 前後の空白を削除した上で一致するかを確認します。
 *
 * マッチした場合は [matchIndexStart, matchIndexEnd] を返し、マッチしなければ false を返します。
 *
 * @param originalContent オリジナルのファイル内容
 * @param searchContent 検索するコンテンツ（置換前の内容）
 * @param startIndex オリジナルコンテンツ内で検索を開始する文字位置
 * @returns [開始文字位置, 終了文字位置] のタプル、または false
 */
function lineTrimmedFallbackMatch(originalContent: string, searchContent: string, startIndex: number): [number, number] | false {
	const originalLines = originalContent.split("\n")
	const searchLines = searchContent.split("\n")

	if (searchLines[searchLines.length - 1] === "") {
		searchLines.pop()
	}

	let startLineNum = 0
	let currentIndex = 0
	while (currentIndex < startIndex && startLineNum < originalLines.length) {
		currentIndex += originalLines[startLineNum].length + 1
		startLineNum++
	}

	for (let i = startLineNum; i <= originalLines.length - searchLines.length; i++) {
		let matches = true

		for (let j = 0; j < searchLines.length; j++) {
			const originalTrimmed = originalLines[i + j].trim()
			const searchTrimmed = searchLines[j].trim()
			if (originalTrimmed !== searchTrimmed) {
				matches = false
				break
			}
		}

		if (matches) {
			// マッチが見つかった場合、正確な文字位置を計算する
			let matchStartIndex = 0
			for (let k = 0; k < i; k++) {
				matchStartIndex += originalLines[k].length + 1
			}

			// 終了位置の計算を修正
			let matchEndIndex = matchStartIndex
			for (let k = 0; k < searchLines.length; k++) {
				matchEndIndex += originalLines[i + k].length + 1
			}
			// 最後の改行を削除
			matchEndIndex -= 1

			return [matchStartIndex, matchEndIndex]
		}
	}

	return false
}

/**
 * ブロックアンカーフォールバックマッチ
 *
 * コードブロックの最初と最後の行をアンカーとして利用し、ブロック全体のマッチを試みる方法です。
 * ・3 行以上のブロックに対してのみ試行（誤検知を避けるため）
 * ・検索コンテンツから先頭行と末尾行をそれぞれ抽出し、オリジナルコンテンツ内で
 *   同じ位置にそれらがあるかをチェックします。
 *
 * @param originalContent オリジナルのファイル内容
 * @param searchContent 検索するコンテンツ（置換前の内容）
 * @param startIndex オリジナルコンテンツ内で検索を開始する文字位置
 * @returns [開始位置, 終了位置] のタプル、または false
 */
function blockAnchorFallbackMatch(originalContent: string, searchContent: string, startIndex: number): [number, number] | false {
	const originalLines = originalContent.split("\n")
	const searchLines = searchContent.split("\n")

	if (searchLines.length < 3) {
		return false
	}

	if (searchLines[searchLines.length - 1] === "") {
		searchLines.pop()
	}

	const firstLineSearch = searchLines[0].trim()
	const lastLineSearch = searchLines[searchLines.length - 1].trim()
	const searchBlockSize = searchLines.length

	let startLineNum = 0
	let currentIndex = 0
	while (currentIndex < startIndex && startLineNum < originalLines.length) {
		currentIndex += originalLines[startLineNum].length + 1
		startLineNum++
	}

	for (let i = startLineNum; i <= originalLines.length - searchBlockSize; i++) {
		if (originalLines[i].trim() !== firstLineSearch) {
			continue
		}

		if (originalLines[i + searchBlockSize - 1].trim() !== lastLineSearch) {
			continue
		}

		// 一致が確認できたら、正確な文字位置を計算する
		let matchStartIndex = 0
		for (let k = 0; k < i; k++) {
			matchStartIndex += originalLines[k].length + 1
		}

		// 終了位置の計算を修正
		let matchEndIndex = matchStartIndex
		for (let k = 0; k < searchBlockSize; k++) {
			matchEndIndex += originalLines[i + k].length + 1
		}
		// 最後の改行を削除
		matchEndIndex -= 1

		return [matchStartIndex, matchEndIndex]
	}
	return false
}

/**
 * オリジナルのファイル内容から検索文字列を探し、置換文字列で置き換えます。
 *
 * @param originalContent オリジナルのファイル内容
 * @param searchContent   検索する文字列
 * @param replaceContent  置換する文字列
 * @returns 構築された新しいファイル内容
 */
export async function constructNewFileContent(
	originalContent: string,
	searchContent: string,
	replaceContent: string,
): Promise<string> {
	let searchMatchIndex = -1
	let searchEndIndex = -1

	if (!searchContent) {
		// SEARCH セクションが空の場合
		if (originalContent.length === 0) {
			// 新規ファイル作成シナリオ
			return replaceContent //replaceContentが新しいファイルの内容になる
		} else {
			// 完全なファイル置換シナリオ
			return replaceContent
		}
	}

	// 完全一致による検索
	const exactIndex = originalContent.indexOf(searchContent)
	if (exactIndex !== -1) {
		searchMatchIndex = exactIndex
		searchEndIndex = exactIndex + searchContent.length
	} else {
		// 行トリム一致の試行
		const lineMatch = lineTrimmedFallbackMatch(originalContent, searchContent, 0)
		if (lineMatch) {
			;[searchMatchIndex, searchEndIndex] = lineMatch
		} else {
			// ブロックアンカー一致の試行
			const blockMatch = blockAnchorFallbackMatch(originalContent, searchContent, 0)
			if (blockMatch) {
				;[searchMatchIndex, searchEndIndex] = blockMatch
			} else {
				// マッチが見つからなかった場合は、置換せずに元のコンテンツを返す
				return originalContent
			}
		}
	}
	// マッチが見つかったら置換を行う
	if (searchMatchIndex !== -1) {
		const result = originalContent.slice(0, searchMatchIndex) + replaceContent + originalContent.slice(searchEndIndex)
		return result
	}

	return originalContent
}
