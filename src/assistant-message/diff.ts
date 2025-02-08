/**
 * 与えられた検索コンテンツに対して、オリジナルコンテンツ内で行ごとにトリムしたフォールバックマッチを試みます。
 * `searchContent` の各行と、`originalContent` の `lastProcessedIndex` 以降の行ブロックを比較し、
 * 前後の空白を削除した上で一致するかを確認します。
 *
 * マッチした場合は [matchIndexStart, matchIndexEnd] を返し、マッチしなければ false を返します。
 *
 * @param originalContent オリジナルのファイル内容
 * @param searchContent 検索するコンテンツ（置換前の内容）
 * @param startIndex オリジナルコンテンツ内で検索を開始する文字位置
 * @returns [開始文字位置, 終了文字位置] のタプル、または false
 */
function lineTrimmedFallbackMatch(
	originalContent: string,
	searchContent: string,
	startIndex: number
): [number, number] | false {
	// オリジナルと検索コンテンツを行ごとに分割
	const originalLines = originalContent.split("\n")
	const searchLines = searchContent.split("\n")
	console.log("[lineTrimmedFallbackMatch] originalLines:", originalLines)
	console.log("[lineTrimmedFallbackMatch] searchLines:", searchLines)

	// 検索コンテンツの末尾に空行がある場合、削除する（末尾の \n による空行）
	if (searchLines[searchLines.length - 1] === "") {
		searchLines.pop()
		console.log("[lineTrimmedFallbackMatch] 空行を削除後の searchLines:", searchLines)
	}

	// startIndex がどの行に該当するかを計算する
	let startLineNum = 0
	let currentIndex = 0
	while (currentIndex < startIndex && startLineNum < originalLines.length) {
		currentIndex += originalLines[startLineNum].length + 1 // 改行分 +1
		startLineNum++
	}
	console.log("[lineTrimmedFallbackMatch] 検索開始行番号:", startLineNum)

	// オリジナルコンテンツ内の各開始位置から検索行ブロックが一致するか試す
	for (let i = startLineNum; i <= originalLines.length - searchLines.length; i++) {
		let matches = true

		// この位置からすべての検索行が一致するか確認する
		for (let j = 0; j < searchLines.length; j++) {
			const originalTrimmed = originalLines[i + j].trim()
			const searchTrimmed = searchLines[j].trim()
			if (originalTrimmed !== searchTrimmed) {
				matches = false
				break
			}
		}

		// マッチが見つかった場合、正確な文字位置を計算する
		if (matches) {
			let matchStartIndex = 0
			for (let k = 0; k < i; k++) {
				matchStartIndex += originalLines[k].length + 1 // 改行分 +1
			}

			let matchEndIndex = matchStartIndex
			for (let k = 0; k < searchLines.length; k++) {
				matchEndIndex += originalLines[i + k].length + 1 // 改行分 +1
			}
			console.log("[lineTrimmedFallbackMatch] マッチ発見: 開始位置=", matchStartIndex, " 終了位置=", matchEndIndex)
			return [matchStartIndex, matchEndIndex]
		}
	}

	console.log("[lineTrimmedFallbackMatch] マッチなし")
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
function blockAnchorFallbackMatch(
	originalContent: string,
	searchContent: string,
	startIndex: number
): [number, number] | false {
	const originalLines = originalContent.split("\n")
	const searchLines = searchContent.split("\n")

	console.log("[blockAnchorFallbackMatch] originalLines:", originalLines)
	console.log("[blockAnchorFallbackMatch] searchLines:", searchLines)

	// 3 行未満のブロックの場合は、この方法は使用しない
	if (searchLines.length < 3) {
		console.log("[blockAnchorFallbackMatch] searchLines.length < 3")
		return false
	}

	// 末尾の空行があれば削除する
	if (searchLines[searchLines.length - 1] === "") {
		searchLines.pop()
		console.log("[blockAnchorFallbackMatch] 空行を削除後の searchLines:", searchLines)
	}

	const firstLineSearch = searchLines[0].trim()
	const lastLineSearch = searchLines[searchLines.length - 1].trim()
	const searchBlockSize = searchLines.length

	// startIndex がどの行に該当するかを計算する
	let startLineNum = 0
	let currentIndex = 0
	while (currentIndex < startIndex && startLineNum < originalLines.length) {
		currentIndex += originalLines[startLineNum].length + 1
		startLineNum++
	}
	console.log("[blockAnchorFallbackMatch] 検索開始行番号:", startLineNum)

	// 最初と最後のアンカー行が一致する箇所を探す
	for (let i = startLineNum; i <= originalLines.length - searchBlockSize; i++) {
		// 先頭行が一致するかチェック
		if (originalLines[i].trim() !== firstLineSearch) {
			continue
		}

		// 終了行が期待通り一致するかチェック
		if (originalLines[i + searchBlockSize - 1].trim() !== lastLineSearch) {
			continue
		}

		// 一致が確認できたら、正確な文字位置を計算する
		let matchStartIndex = 0
		for (let k = 0; k < i; k++) {
			matchStartIndex += originalLines[k].length + 1
		}

		let matchEndIndex = matchStartIndex
		for (let k = 0; k < searchBlockSize; k++) {
			matchEndIndex += originalLines[i + k].length + 1
		}

		console.log("[blockAnchorFallbackMatch] マッチ発見: 開始位置=", matchStartIndex, " 終了位置=", matchEndIndex)
		return [matchStartIndex, matchEndIndex]
	}

	console.log("[blockAnchorFallbackMatch] マッチなし")
	return false
}

/**
 * ストリームされた diff（SEARCH/REPLACE ブロック形式）を元に、
 * オリジナルのファイル内容に変更を適用し、新しいファイル内容を構築します。
 *
 * この diff 形式は以下の 3 つのマーカーを使用します:
 * 
 *   <<<<<<< SEARCH
 *   [オリジナルから検索する内容]
 *   =======
 *   [置換後の内容]
 *   >>>>>>> REPLACE
 *
 * 挙動および前提:
 * 1. ファイルはチャンクごとに処理されます。各チャンクは部分的または完全な SEARCH/REPLACE ブロックを含む場合があります。
 *    この関数は、各更新チャンク（最終チャンクの場合は isFinal=true）ごとに呼び出され、
 *    最終的なファイル内容を構築します。
 *
 * 2. マッチング戦略（試行順）:
 *    a. 完全一致: まず、オリジナルファイル内で SEARCH ブロックの内容と完全一致する位置を探す。
 *    b. 行トリム一致: 前後の空白を無視して行ごとに比較するフォールバック戦略。
 *    c. ブロックアンカー一致: 3 行以上の場合、先頭と末尾の行をアンカーとして利用する戦略。
 *    いずれの戦略でもマッチしなければエラーをスローします。
 *
 * 3. 空の SEARCH セクション:
 *    - SEARCH が空で、オリジナルファイルも空の場合は、新規ファイル作成（挿入のみ）と判断します。
 *    - SEARCH が空で、オリジナルファイルが空でない場合は、ファイル全体の置換とみなします。
 *
 * 4. 変更の適用:
 *    - "=======" マーカーまでの内容は検索内容として蓄積される。
 *    - "=======" マーカー以降、 ">>>>>>> REPLACE" までの内容は置換内容として蓄積される。
 *    - ブロックが完了すると、オリジナルファイル内の該当箇所を置換内容で更新し、
 *      オリジナルの処理位置を進めます。
 *
 * 5. インクリメンタル出力:
 *    - マッチ位置が見つかり REPLACE セクションに入ったら、その置換行を結果に逐次追加します。
 *
 * 6. 部分的なマーカー:
 *    - チャンクの最終行が部分的なマーカーである場合、それが既知のマーカーでなければ削除します。
 *
 * 7. 最終化:
 *    - 全チャンク処理完了後（isFinal が true）、最後の置換箇所以降のオリジナル内容を結果に追加します。
 *    - 余分な末尾改行は追加しません。
 *
 * エラー:
 * - 利用可能なマッチ戦略ですべてのマッチに失敗した場合、エラーをスローします。
 *
 * @param diffContent 適用する diff の内容
 * @param originalContent オリジナルのファイル内容
 * @param isFinal 最終チャンクかどうかのフラグ
 * @returns 構築された新しいファイル内容
 */
export async function constructNewFileContent(
	diffContent: string,
	originalContent: string,
	isFinal: boolean
): Promise<string> {
	let result = ""
	let lastProcessedIndex = 0

	let currentSearchContent = ""
	let currentReplaceContent = ""
	let inSearch = false
	let inReplace = false

	let searchMatchIndex = -1
	let searchEndIndex = -1

	let lines = diffContent.split("\n")
	console.log("[constructNewFileContent] diffContent 行数:", lines.length)

	// チャンクの最終行が不完全なマーカーの場合、削除する
	const lastLine = lines[lines.length - 1]
	if (
		lines.length > 0 &&
		(lastLine.startsWith("<") || lastLine.startsWith("=") || lastLine.startsWith(">")) &&
		lastLine !== "<<<<<<< SEARCH" &&
		lastLine !== "=======" &&
		lastLine !== ">>>>>>> REPLACE"
	) {
		console.log("[constructNewFileContent] 不完全なマーカー行を削除:", lastLine)
		lines.pop()
	}

	// 行ごとに処理
	for (const line of lines) {
		if (line === "<<<<<<< SEARCH") {
			console.log("[constructNewFileContent] '<<<<< SEARCH' を検出")
			inSearch = true
			currentSearchContent = ""
			currentReplaceContent = ""
			continue
		}

		if (line === "=======") {
			console.log("[constructNewFileContent] '=======' を検出。SEARCH セクション終了、REPLACE セクション開始")
			inSearch = false
			inReplace = true

			// currentSearchContent の末尾改行の処理（必要に応じて削除する場合は下記コメントを参照）
			/*
			if (currentSearchContent.endsWith("\r\n")) {
				currentSearchContent = currentSearchContent.slice(0, -2)
			} else if (currentSearchContent.endsWith("\n")) {
				currentSearchContent = currentSearchContent.slice(0, -1)
			}
			*/

			if (!currentSearchContent) {
				// SEARCH セクションが空の場合
				if (originalContent.length === 0) {
					// 新規ファイル作成シナリオ
					searchMatchIndex = 0
					searchEndIndex = 0
					console.log("[constructNewFileContent] 空の SEARCH ブロック（新規ファイル）")
				} else {
					// 完全なファイル置換シナリオ
					searchMatchIndex = 0
					searchEndIndex = originalContent.length
					console.log("[constructNewFileContent] 空の SEARCH ブロック（ファイル全体置換）")
				}
			} else {
				// 完全一致による検索
				const exactIndex = originalContent.indexOf(currentSearchContent, lastProcessedIndex)
				if (exactIndex !== -1) {
					searchMatchIndex = exactIndex
					searchEndIndex = exactIndex + currentSearchContent.length
					console.log("[constructNewFileContent] 完全一致発見: 開始=", searchMatchIndex, " 終了=", searchEndIndex)
				} else {
					// 行トリム一致の試行
					const lineMatch = lineTrimmedFallbackMatch(originalContent, currentSearchContent, lastProcessedIndex)
					if (lineMatch) {
						;[searchMatchIndex, searchEndIndex] = lineMatch
						console.log("[constructNewFileContent] 行トリム一致発見: 開始=", searchMatchIndex, " 終了=", searchEndIndex)
					} else {
						// ブロックアンカー一致の試行
						const blockMatch = blockAnchorFallbackMatch(originalContent, currentSearchContent, lastProcessedIndex)
						if (blockMatch) {
							;[searchMatchIndex, searchEndIndex] = blockMatch
							console.log("[constructNewFileContent] ブロックアンカー一致発見: 開始=", searchMatchIndex, " 終了=", searchEndIndex)
						} else {
							throw new Error(
								`SEARCH ブロック:\n${currentSearchContent.trimEnd()}\n...がファイル内のどこにもマッチしませんでした。`
							)
						}
					}
				}
			}

			// マッチ位置までのオリジナル内容を結果に追加
			result += originalContent.slice(lastProcessedIndex, searchMatchIndex)
			console.log("[constructNewFileContent] 結果に追加: 文字位置", lastProcessedIndex, "から", searchMatchIndex)
			continue
		}

		if (line === ">>>>>>> REPLACE") {
			console.log("[constructNewFileContent] '>>>>>>> REPLACE' を検出。置換ブロック終了")
			// ひとつの置換ブロックが終了したので、処理位置を更新する
			lastProcessedIndex = searchEndIndex

			// 次のブロックに備えてリセット
			inSearch = false
			inReplace = false
			currentSearchContent = ""
			currentReplaceContent = ""
			searchMatchIndex = -1
			searchEndIndex = -1
			continue
		}

		// SEARCH または REPLACE セクションの内容を蓄積する
		if (inSearch) {
			currentSearchContent += line + "\n"
		} else if (inReplace) {
			currentReplaceContent += line + "\n"
			// 置換内容は、マッチ位置がわかっている場合、逐次結果に追加する
			if (searchMatchIndex !== -1) {
				result += line + "\n"
				console.log("[constructNewFileContent] 置換行を追加:", line)
			}
		}
	}

	// 最終チャンクの場合、最後のマッチ位置以降のオリジナル内容を結果に追加する
	if (isFinal && lastProcessedIndex < originalContent.length) {
		result += originalContent.slice(lastProcessedIndex)
		console.log("[constructNewFileContent] 最終更新: 結果に残りを追加、位置", lastProcessedIndex, "以降")
	}

	console.log("[constructNewFileContent] 最終結果の長さ:", result.length)
	return result
}
