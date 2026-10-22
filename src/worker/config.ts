/**
 * 서비스 전역 설정.
 *
 * 현재는 김천고등학교 한 곳만 운영한다.
 * 나중에 학교를 추가하려면:
 *   1) schools 테이블에 행 추가 (id, name, created_at)
 *   2) 아래 SCHOOL_ID 를 새 학교의 id로 변경
 * 데이터베이스 마이그레이션은 학교별로 분리하지 않는다.
 */

/** 서비스가 사용하는 학교 이름 */
export const SCHOOL_NAME = "김천고등학교";

/** schools 테이블의 해당 학교 id (마이그레이션에서 1로 고정 생성) */
export const SCHOOL_ID = 1;

/** 서비스 표시 이름 */
export const SERVICE_NAME = "김천고등학교 랭킹";

/** 서비스 한 줄 설명 */
export const SERVICE_TAGLINE = "교내 리그 오브 레전드 랭킹 순위";
