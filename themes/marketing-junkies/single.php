<?php
/**
 * Single article (design option 1a / 1b).
 *
 * @package marketing-junkies
 */

get_header();
the_post();
$mj_post    = get_post();
$mj_article = mj_prepare_article( $mj_post );
$mj_cat     = mj_primary_category( $mj_post );
$mj_sponsor = mj_is_sponsored( $mj_post );
$mj_tags    = array_filter( wp_get_post_tags( $mj_post->ID ), fn( $t ) => 'sponsored' !== $t->slug );
$mj_updated = get_the_modified_time( 'U' ) - get_the_time( 'U' ) > HOUR_IN_SECONDS;
$mj_author  = get_the_author_meta( 'display_name' );
$mj_bio     = get_the_author_meta( 'description' ) ?: get_theme_mod( 'mj_author_blurb', 'Marketing Junkies covers agency moves, campaigns, martech and adtech launches with an Indian and global lens. Every story is written from a named source and links back to it.' );
?>
<article <?php post_class( 'mj-article' ); ?> itemscope itemtype="https://schema.org/NewsArticle">
	<div class="mj-article-grid">
		<main id="main">
			<?php mj_breadcrumb( $mj_post ); ?>

			<?php if ( $mj_sponsor ) : ?>
				<div class="mj-sponsored">
					<strong class="mj-sponsored-label"><?php esc_html_e( 'Sponsored', 'marketing-junkies' ); ?></strong>
					<span>
						<?php
						$mj_sponsor_name = get_post_meta( $mj_post->ID, 'mj_sponsor', true );
						if ( $mj_sponsor_name ) {
							/* translators: %s: sponsor name */
							printf( esc_html__( 'Paid content produced with %s. The Marketing Junkies newsroom was not involved.', 'marketing-junkies' ), '<strong>' . esc_html( $mj_sponsor_name ) . '</strong>' );
						} else {
							esc_html_e( 'Paid content. The Marketing Junkies newsroom was not involved.', 'marketing-junkies' );
						}
						?>
					</span>
					<?php if ( get_theme_mod( 'mj_advertise_url' ) ) : ?>
						<a href="<?php echo esc_url( get_theme_mod( 'mj_advertise_url' ) ); ?>"><?php esc_html_e( 'Advertise with us', 'marketing-junkies' ); ?></a>
					<?php endif; ?>
				</div>
			<?php endif; ?>

			<p class="mj-kicker"><?php echo esc_html( mj_kicker( $mj_post ) ); ?></p>
			<h1 class="mj-title" itemprop="headline"><?php the_title(); ?></h1>
			<?php if ( has_excerpt() ) : ?>
				<p class="mj-standfirst" itemprop="description"><?php echo esc_html( wp_strip_all_tags( get_the_excerpt() ) ); ?></p>
			<?php endif; ?>

			<div class="mj-byline">
				<div class="mj-avatar" aria-hidden="true"><?php echo get_avatar( get_the_author_meta( 'ID' ), 80, '', '', array( 'loading' => 'lazy' ) ); ?></div>
				<div class="mj-byline-text">
					<div class="mj-author" itemprop="author" itemscope itemtype="https://schema.org/Person"><a href="<?php echo esc_url( get_author_posts_url( get_the_author_meta( 'ID' ) ) ); ?>" itemprop="url"><span itemprop="name"><?php echo esc_html( $mj_author ); ?></span></a></div>
					<div class="mj-dates">
						<time itemprop="datePublished" datetime="<?php echo esc_attr( get_the_date( DATE_W3C ) ); ?>"><?php echo esc_html( get_the_date( 'j M Y, H:i' ) ); ?> IST</time>
						<?php if ( $mj_updated ) : ?>
							· <?php esc_html_e( 'Updated', 'marketing-junkies' ); ?> <time itemprop="dateModified" datetime="<?php echo esc_attr( get_the_modified_date( DATE_W3C ) ); ?>"><?php echo esc_html( get_the_modified_date( 'j M, H:i' ) ); ?></time>
						<?php else : ?>
							<meta itemprop="dateModified" content="<?php echo esc_attr( get_the_modified_date( DATE_W3C ) ); ?>">
						<?php endif; ?>
					</div>
				</div>
				<div class="mj-byline-tools">
					<span><?php echo esc_html( sprintf( /* translators: %d: minutes */ __( '%d min read', 'marketing-junkies' ), mj_reading_time( $mj_post ) ) ); ?></span><span aria-hidden="true">·</span>
					<button type="button" data-mj-share data-title="<?php echo esc_attr( get_the_title() ); ?>" data-url="<?php echo esc_url( get_permalink() ); ?>"><?php esc_html_e( 'Share', 'marketing-junkies' ); ?></button>
					<button type="button" data-mj-copy data-url="<?php echo esc_url( get_permalink() ); ?>"><?php esc_html_e( 'Copy link', 'marketing-junkies' ); ?></button>
				</div>
			</div>

			<?php if ( has_post_thumbnail() ) : ?>
				<figure class="mj-figure">
					<div class="grayscale"><?php the_post_thumbnail( 'post-thumbnail', array( 'itemprop' => 'image', 'fetchpriority' => 'high', 'loading' => 'eager' ) ); ?></div>
					<?php
					$mj_caption = get_the_post_thumbnail_caption();
					if ( $mj_caption ) :
						?>
						<figcaption><?php echo esc_html( $mj_caption ); ?></figcaption>
					<?php endif; ?>
				</figure>
			<?php endif; ?>

			<div class="mj-body-grid">
				<?php if ( count( $mj_article['toc'] ) >= 2 ) : ?>
					<aside class="mj-toc" aria-label="<?php esc_attr_e( 'In this story', 'marketing-junkies' ); ?>">
						<div class="mj-toc-title"><?php esc_html_e( 'In this story', 'marketing-junkies' ); ?></div>
						<ol data-mj-toc>
							<?php foreach ( $mj_article['toc'] as $i => $h ) : ?>
								<li<?php echo 0 === $i ? ' class="is-active"' : ''; ?>><a href="#<?php echo esc_attr( $h['id'] ); ?>"><?php echo esc_html( $h['title'] ); ?></a></li>
							<?php endforeach; ?>
							<?php if ( $mj_article['faq'] ) : ?>
								<li><a href="#faq"><?php esc_html_e( 'FAQ', 'marketing-junkies' ); ?></a></li>
							<?php endif; ?>
						</ol>
					</aside>
				<?php else : ?>
					<div></div>
				<?php endif; ?>

				<div>
					<?php if ( count( $mj_article['toc'] ) >= 2 ) : ?>
						<details class="mj-toc-mobile">
							<summary><?php esc_html_e( 'In this story', 'marketing-junkies' ); ?></summary>
							<ol>
								<?php foreach ( $mj_article['toc'] as $h ) : ?>
									<li><a href="#<?php echo esc_attr( $h['id'] ); ?>"><?php echo esc_html( $h['title'] ); ?></a></li>
								<?php endforeach; ?>
							</ol>
						</details>
					<?php endif; ?>

					<div class="mj-body" itemprop="articleBody">
						<?php echo $mj_article['html']; // phpcs:ignore WordPress.Security.EscapeOutput -- post content, already filtered. ?>
					</div>

					<?php if ( $mj_tags ) : ?>
						<div class="mj-tags">
							<?php foreach ( $mj_tags as $t ) : ?>
								<a class="tag tag-outline" href="<?php echo esc_url( get_tag_link( $t ) ); ?>"><?php echo esc_html( $t->name ); ?></a>
							<?php endforeach; ?>
						</div>
					<?php endif; ?>

					<section class="mj-author-box" aria-label="<?php esc_attr_e( 'About the author', 'marketing-junkies' ); ?>">
						<div class="mj-avatar" aria-hidden="true"><?php echo get_avatar( get_the_author_meta( 'ID' ), 144, '', '', array( 'loading' => 'lazy' ) ); ?></div>
						<div>
							<p class="mj-label"><?php esc_html_e( 'Written by', 'marketing-junkies' ); ?></p>
							<div class="mj-author-name"><?php echo esc_html( $mj_author ); ?></div>
							<p><?php echo esc_html( $mj_bio ); ?></p>
							<nav>
								<?php if ( mj_page_link( 'editorial-policy' ) ) : ?><a href="<?php echo esc_url( mj_page_link( 'editorial-policy' ) ); ?>"><?php esc_html_e( 'Editorial policy', 'marketing-junkies' ); ?></a><?php endif; ?>
								<?php if ( mj_page_link( 'corrections' ) ) : ?><a href="<?php echo esc_url( mj_page_link( 'corrections' ) ); ?>"><?php esc_html_e( 'Corrections', 'marketing-junkies' ); ?></a><?php endif; ?>
								<a href="<?php echo esc_url( get_author_posts_url( get_the_author_meta( 'ID' ) ) ); ?>"><?php esc_html_e( 'All stories', 'marketing-junkies' ); ?></a>
							</nav>
						</div>
					</section>
				</div>
			</div>
		</main>

		<?php get_sidebar(); ?>
	</div>

	<?php
	$mj_related = mj_related_posts( $mj_post, 4 );
	if ( $mj_related ) :
		?>
		<section class="mj-related" aria-label="<?php esc_attr_e( 'Related stories', 'marketing-junkies' ); ?>">
			<div class="mj-section-head">
				<h2><?php esc_html_e( 'Related', 'marketing-junkies' ); ?></h2>
				<?php if ( $mj_cat ) : ?>
					<a href="<?php echo esc_url( get_term_link( $mj_cat ) ); ?>"><?php echo esc_html( sprintf( /* translators: %s: category */ __( 'More %s', 'marketing-junkies' ), strtolower( $mj_cat->name ) ) ); ?></a>
				<?php endif; ?>
			</div>
			<div class="mj-grid mj-grid-4">
				<?php foreach ( $mj_related as $p ) { mj_card( $p ); } ?>
			</div>
		</section>
	<?php endif; ?>
</article>
<?php
get_footer();
