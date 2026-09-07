<?php
/**
 * The contract between the PHP model port and the JavaScript reference (HANDOVER.md §7).
 * Run:  node tests/fixtures.mjs > tests/fixtures.json && php tests/model-equality.php
 * Exit code 0 only if every fixture matches to 1e-9 relative (and therefore to the paisa).
 */
require __DIR__ . '/../includes/class-model.php';
$fixtures = json_decode( file_get_contents( __DIR__ . '/fixtures.json' ), true );
$inputs   = json_decode( file_get_contents( __DIR__ . '/fixture-inputs.json' ), true );
$fail = 0; $checked = 0;
$close = static function ( $a, $b ): bool { return abs( $a - $b ) <= 1e-9 * max( 1.0, abs( $a ), abs( $b ) ); };
foreach ( $fixtures as $key => $exp ) {
	list( $id, $mode ) = explode( ':', $key );
	$in = $inputs[ $id ];
	$r  = SSPulse_Model::compute( $in['s'], $mode === 'samples' ? $in['samples'] : array() );
	$flat = static function ( $prefix, $v ) use ( &$flat ) { $out = array(); if ( is_array( $v ) ) { foreach ( $v as $k => $x ) { $out += $flat( "$prefix.$k", $x ); } } else { $out[ $prefix ] = $v; } return $out; };
	$e = $flat( '', array( 'buzz' => $exp['buzz'], 'q' => $exp['q'], 'intent' => $exp['intent'], 'd1' => $exp['d1'], 'sdD1' => $exp['sdD1'], 'occ' => $exp['occ'], 'gap' => $exp['gap'], 'life' => $exp['life'], 'weekend' => $exp['weekend'], 'week1' => $exp['week1'], 'mc' => $exp['mc'], 'ratio' => $exp['ratio'], 'pHit' => $exp['pHit'] ) );
	$g = $flat( '', array( 'buzz' => $r['buzz'], 'q' => $r['q'], 'intent' => $r['intent'], 'd1' => $r['d1'], 'sdD1' => $r['sdD1'], 'occ' => $r['occ'], 'gap' => $r['gap'], 'life' => $r['life'], 'weekend' => $r['weekend'], 'week1' => $r['week1'], 'mc' => $r['mc'], 'ratio' => $r['ratio'], 'pHit' => $r['pHit'] ) );
	foreach ( $e as $path => $ev ) {
		$checked++;
		if ( ! isset( $g[ $path ] ) || ! $close( $ev, $g[ $path ] ) ) { $fail++; printf( "MISMATCH %s %s: js=%s php=%s\n", $key, $path, var_export( $ev, true ), var_export( $g[ $path ] ?? null, true ) ); }
	}
	if ( $exp['verdict'] !== $r['verdict'][0] ) { $fail++; echo "MISMATCH $key verdict\n"; }
	printf( "%-24s buzz %.4f  life %.2f  d1 [%.2f %.2f %.2f]  %s\n", $key, $r['buzz'], $r['life'], $r['mc']['d1'][0], $r['mc']['d1'][1], $r['mc']['d1'][2], $r['verdict'][0] );
}
printf( "%d values checked, %d mismatches\n", $checked, $fail );
exit( $fail ? 1 : 0 );
