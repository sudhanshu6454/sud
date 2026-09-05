<?php
/**
 * In the news (News CPT = `post`, autopub's output) + top lists.
 *
 * @package marketing-mentalist
 */

$mm_news = get_posts( array( 'post_type' => 'post', 'posts_per_page' => 5, 'no_found_rows' => true ) );
$mm_lists = get_posts( array( 'post_type' => 'mm_list', 'posts_per_page' => 4, 'no_found_rows' => true ) );
if ( ! $mm_news && ! $mm_lists ) {
	return;
}
?>
<section class="mm-section" style="display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr)">
	<div style="padding:56px var(--gutter);<?php echo $mm_lists ? 'border-right:var(--rule)' : ''; ?>">
		<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:20px">
			<h2 style="font-size:28px;letter-spacing:-.02em">In the news</h2>
			<a href="<?php echo esc_url( home_url( '/' ) ); ?>" style="font:600 13px/1 var(--font-display)">All news →</a>
		</div>
		<div>
			<?php foreach ( $mm_news as $n ) : $mm_cats = get_the_category( $n ); ?>
				<a class="mm-news-row" href="<?php echo esc_url( get_permalink( $n ) ); ?>">
					<span class="mm-meta" style="color:var(--mm-signal)"><?php echo esc_html( $mm_cats ? $mm_cats[0]->name : 'News' ); ?></span>
					<span class="mm-news-title" style="font:500 17px/1.3 var(--font-display)"><?php echo esc_html( get_the_title( $n ) ); ?></span>
					<span class="mm-meta"><?php echo esc_html( human_time_diff( get_the_time( 'U', $n ) ) ); ?></span>
				</a>
			<?php endforeach; ?>
		</div>
	</div>
	<?php if ( $mm_lists ) : ?>
	<div style="padding:56px var(--gutter)">
		<h2 style="font-size:28px;letter-spacing:-.02em;margin-bottom:20px">Top lists</h2>
		<ol style="list-style:none;margin:0;padding:0">
			<?php foreach ( $mm_lists as $i => $l ) : ?>
				<li class="mm-list-row"><a href="<?php echo esc_url( get_permalink( $l ) ); ?>" style="display:contents"><span class="mm-list-n"><?php echo esc_html( str_pad( (string) ( $i + 1 ), 2, '0', STR_PAD_LEFT ) ); ?></span><span style="font:600 18px/1.3 var(--font-display);letter-spacing:-.01em"><?php echo esc_html( get_the_title( $l ) ); ?></span></a></li>
			<?php endforeach; ?>
		</ol>
	</div>
	<?php endif; ?>
</section>
