<?php
/**
 * Validation rules from HANDOVER.md §4 and the public route's field whitelist (§6).
 * PHPUnit-compatible; tests/run-tests.php runs it with or without PHPUnit installed.
 */
require_once __DIR__ . '/../includes/class-model.php';
require_once __DIR__ . '/../includes/class-validate.php';

class ValidateTest extends TestCase {
	private function good(): array {
		return array( 'tr24' => 38, 'trTotal' => 96, 'likeRatio' => 41, 'search' => 82, 'posts' => 210, 'sentiment' => 71, 'bms' => 1400, 'song' => 140, 'star' => 84, 'screens' => 4200, 'shows' => 5, 'seats' => 200, 'atp' => 240, 'budget' => 260, 'days' => 12, 'holiday' => '1', 'comp' => 'none', 'kInt' => 3.8, 'bias' => 0.25 );
	}
	public function test_full_signals_accepted() { $this->assertNull( SSPulse_Validate::signals( $this->good() ) ); }
	public function test_missing_signal_rejected_when_not_partial() { $s = $this->good(); unset( $s['bms'] ); $this->assertStringContainsString( "missing signal 'bms'", SSPulse_Validate::signals( $s ) ); }
	public function test_partial_signals_accepted() { $this->assertNull( SSPulse_Validate::signals( array( 'bms' => 900 ), true ) ); }
	public function test_out_of_range_rejected() {
		$this->assertStringContainsString( 'tr24 must be between 0 and 120', SSPulse_Validate::signals( array( 'tr24' => 121 ), true ) );
		$this->assertStringContainsString( 'screens must be between 100 and 6000', SSPulse_Validate::signals( array( 'screens' => 50 ), true ) );
		$this->assertStringContainsString( 'kInt must be between 0.5 and 6', SSPulse_Validate::signals( array( 'kInt' => 0.1 ), true ) );
	}
	public function test_every_declared_range_is_enforced() {
		foreach ( SSPulse_Model::RANGES as $k => list( $lo, $hi ) ) {
			$this->assertNull( SSPulse_Validate::signals( array( $k => $lo ), true ), "$k at min" );
			$this->assertNull( SSPulse_Validate::signals( array( $k => $hi ), true ), "$k at max" );
			$this->assertNotNull( SSPulse_Validate::signals( array( $k => $hi + 1 ), true ), "$k above max" );
			$this->assertNotNull( SSPulse_Validate::signals( array( $k => $lo - 1 ), true ), "$k below min" );
		}
	}
	public function test_holiday_and_comp_enums() {
		$this->assertNull( SSPulse_Validate::signals( array( 'holiday' => '0', 'comp' => 'heavy' ), true ) );
		$this->assertNotNull( SSPulse_Validate::signals( array( 'holiday' => 'yes' ), true ) );
		$this->assertNotNull( SSPulse_Validate::signals( array( 'comp' => 'brutal' ), true ) );
	}
	public function test_unknown_signal_rejected() { $this->assertStringContainsString( "unknown signal 'foo'", SSPulse_Validate::signals( array( 'foo' => 1 ), true ) ); }
	public function test_non_numeric_rejected() { $this->assertStringContainsString( 'bms must be numeric', SSPulse_Validate::signals( array( 'bms' => 'lots' ), true ) ); }
	public function test_release_date_format() {
		$this->assertNull( SSPulse_Validate::signals( array( 'release' => '2026-09-11' ), true ) );
		$this->assertNull( SSPulse_Validate::signals( array( 'release' => '' ), true ) );
		$this->assertNotNull( SSPulse_Validate::signals( array( 'release' => '11/09/2026' ), true ) );
		$this->assertNotNull( SSPulse_Validate::signals( array( 'release' => '2026-02-30' ), true ) );
	}

	public function test_sample_counts_must_not_exceed_n() {
		$ok = array( 'src' => 'ig', 'taken_on' => '2026-09-01', 'n' => 2140, 'def_ct' => 920, 'prob_ct' => 640, 'ott_ct' => 400, 'no_ct' => 180 );
		$this->assertNull( SSPulse_Validate::sample( $ok ) );
		$this->assertNull( SSPulse_Validate::sample( array_merge( $ok, array( 'no_ct' => 0 ) ) ), 'counts below n are fine (undecided respondents)' );
		$this->assertSame( 'option counts exceed n', SSPulse_Validate::sample( array_merge( $ok, array( 'no_ct' => 181 ) ) ) );
	}
	public function test_sample_n_at_least_one_and_integer() {
		$b = array( 'src' => 'yt', 'taken_on' => '2026-09-01' );
		$this->assertNotNull( SSPulse_Validate::sample( $b + array( 'n' => 0 ) ) );
		$this->assertNotNull( SSPulse_Validate::sample( $b + array( 'n' => 12.5 ) ) );
		$this->assertNotNull( SSPulse_Validate::sample( $b + array( 'n' => -3 ) ) );
		$this->assertNull( SSPulse_Validate::sample( $b + array( 'n' => '1' ) ) );
	}
	public function test_sample_src_must_be_a_known_source() {
		$this->assertNotNull( SSPulse_Validate::sample( array( 'src' => 'tiktok', 'taken_on' => '2026-09-01', 'n' => 10 ) ) );
		foreach ( array_keys( SSPulse_Model::SOURCES ) as $src ) { $this->assertNull( SSPulse_Validate::sample( array( 'src' => $src, 'taken_on' => '2026-09-01', 'n' => 10 ) ), $src ); }
	}
	public function test_reading_rules() {
		$this->assertNull( SSPulse_Validate::reading( array( 'read_on' => '2026-09-07', 'buzz' => 88, 'intent' => 5860000, 'life_p50' => 663.74, 'd1_p10' => 47.5, 'd1_p50' => 59.2, 'd1_p90' => 73.3 ) ) );
		$this->assertNotNull( SSPulse_Validate::reading( array( 'read_on' => '2026-09-07', 'buzz' => 101, 'intent' => 1, 'life_p50' => 1 ) ) );
		$this->assertNotNull( SSPulse_Validate::reading( array( 'read_on' => 'today', 'buzz' => 50, 'intent' => 1, 'life_p50' => 1 ) ) );
		$this->assertNotNull( SSPulse_Validate::reading( array( 'read_on' => '2026-09-07', 'buzz' => 50, 'intent' => -1, 'life_p50' => 1 ) ) );
	}
	public function test_actuals_need_one_positive_figure() {
		$this->assertNull( SSPulse_Validate::actuals( array( 'we' => 120.5 ) ) );
		$this->assertNotNull( SSPulse_Validate::actuals( array( 'd1' => 0, 'we' => 0 ) ) );
		$this->assertNotNull( SSPulse_Validate::actuals( array( 'd1' => -5 ) ) );
	}
	public function test_calendar_row_needs_title_date_and_source() {
		$this->assertNull( SSPulse_Validate::calendar_row( array( 'title' => 'Haiwaan', 'release_date' => '2026-09-11', 'source' => 'Wikipedia · read 7 Sep 2026' ) ) );
		$this->assertNotNull( SSPulse_Validate::calendar_row( array( 'title' => 'Haiwaan', 'release_date' => '2026-09-11' ) ), 'source is mandatory' );
		$this->assertNotNull( SSPulse_Validate::calendar_row( array( 'title' => 'X', 'release_date' => '2026-09-11', 'source' => 's', 'confidence' => 'sure' ) ) );
		$this->assertNull( SSPulse_Validate::calendar_row( array( 'confidence' => 'disputed' ), true ) );
	}

	/** The public payload must never carry more than the figure needs (HANDOVER.md §6). */
	public function test_public_payload_field_whitelist() {
		$src = file_get_contents( __DIR__ . '/../includes/class-rest.php' );
		preg_match( "/public static function public_payload.*?return array\((.*?)\n\t\t\);/s", $src, $m );
		$this->assertNotEmpty( $m, 'public_payload return block found' );
		preg_match_all( "/'([a-z_0-9]+)' =>/", $m[1], $keys );
		$allowed = array( 'title', 'slug', 'release_date', 'status', 'reading', 'previous', 'locked', 'actual', 'basis', 'confidence', 'source', 'read_on', 'recorded_at', 'buzz', 'intent', 'life_p10', 'life_p50', 'life_p90', 'd1_p50', 't', 'd1', 'we', 'wk', 'life', 'd1lo', 'd1hi' );
		foreach ( array_unique( $keys[1] ) as $k ) { $this->assertContains( $k, $allowed, "public payload leaks field '$k'" ); }
		$this->assertStringNotContainsString( 'signals', $m[1], 'signals are internal' );
		$this->assertStringNotContainsString( 'created_by', $m[1] );
	}
}
