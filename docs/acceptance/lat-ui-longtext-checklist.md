# LAT 毛玻璃界面与长文本翻译验收

> 最新验收版本：`0.2.0-beta.3`。安装包：`artifacts/v0.2.0-beta.3/LAT_0.2.0-beta.3_x64-setup.exe`。用户已确认 beta2 全项通过，勾选与反馈保留；beta3 待验收项目见文末。

状态：等待用户验收。以下复选框由用户填写；自动化通过不代替桌面视觉和译文质量验收。

## 验收准备

- 分支：`codex/lat-ui-longtext-stability`，由本地 `master` 创建。
- 版本维持 `0.2.0-beta.1`，此包是本地验收构建，不是 GitHub 发布版本。
- 安装包：`artifacts/v0.2.0-beta.1/LAT_0.2.0-beta.1_x64-setup.exe`。
- 校验文件：同目录 `SHA256SUMS.txt`。安装前请退出旧版 LAT，避免仍连接旧网关。
- 不需要重新下载已有模型；建议使用 Hy-MT2-7B Q6_K 验收。
- 公式样例：本目录 `latex-sample.txt`，包含截图中的公式及额外保护样例。
- 长文样例：`artifacts/validation/long-source.txt`（16,001 字符）、`long-paragraph-source.txt`（17,001 字符单段）、`long-32001-source.txt`（32,001 字符）。
- 当前工作区内容在切换页面、关闭/重新启用模型时保留；退出应用后仅完整翻译历史持久化，不自动恢复未完成草稿。

## Bug 修复

- [x] 在原文中粘贴 `latex-sample.txt`，切换 LaTeX 预览：成员符号 `\in`、范数 `\|`、`\boldsymbol` 正常显示。
- [x] 展示公式保留双美元定界符，编号、上下标和求和结构正确；切换“合并换行”后再次翻译仍正常。
- [x] 中英文互译时所有原始公式保留，顺序正确，无公式丢失或重复；复制文本无意外变更。
- [x] 断网后仍能预览公式；公式过宽时只在预览区域横向滚动。
- [x] 普通译文不带内部 `[结束源文本]` 等标识。样例正文明确写出的该标识应保留，这是正常行为。
- [x] 正常长文不再无故报“流式模型输出未通过结果校验”；真实错误应说明失败段和原因，不能误报成功。

真实长文示例 (example 1)：

```markdown
# Local Curvature Correction for XMMSE on a Quotient Space

## 1. Main results

This is the **main report** for the combined post-XMMSE and quotient-curvature study. Read it first. The [structural supplement](Post_XMMSE_MM_Research.md) retains the residual interpretation, Chord construction, scalar limits, and historical solver details; the [Gaussian numerical supplement](Gaussian_Channel_Linear_Convergence_Audit.md) documents all 400 baseline trajectories. Detailed [rate and MM proofs](../_raw/Quotient_Rates_and_MM_Proofs.md) and [curvature numerical details](../_raw/Quotient_Curvature_Numerical_Details.md) support the statements below.

The main conclusions are:

| Question | Result and qualification |
|---|---|
| Must WSR be locally concave? | Ambient concavity is unnecessary. A nondegenerate constrained local maximum implies local contraction after removing the nonzero phase directions. Arbitrary KKT points do not suffice. |
| Can both methods be sublinear? | Yes. An explicit orthogonal two-user channel at an allocation threshold gives a quartically flat maximum and amplitude error proportional to $t^{-1/2}$ for both methods. |
| Can their rate gap be quantified? | At a common regular maximum, the WMMSE-to-XMMSE envelope curvature reduction has rank at most $K$. A generalized eigenvalue formula gives the exact factor difference and a necessary and sufficient condition for strict improvement. |
| What does the XMMSE linearization represent? | It is the derivative of the actual power-constrained XMMSE update modulo phases, not a new algorithm that only reduces to XMMSE. |
| Is a cubic subproblem essential? | No. Cubic regularization certifies the Taylor remainder; a radius-dependent quadratic regularizer also gives a valid MM model and can retain local quadratic convergence. |
| Is the envelope a tighter quadratic? | The exact phase envelope is tighter but nonquadratic and gives the same optimal update orbit. Its Taylor quadratic alone is not a certified lower bound. |

For MISO-BC, the quotient curvature gap of XMMSE factors exactly as the Gram matrix of a matrix with at most $2K$ rows. Its rank is controlled by the number of users, independently of the number of transmit antennas. Local curvature correction therefore becomes a low-rank update problem.

Building on the [Post-XMMSE research report](Post_XMMSE_MM_Research.md), this report establishes four results.[^5]

1. A globally valid, phase-invariant XMMSE envelope. Eliminating phase alone preserves the equivalence class of the exact update.
2. An explicit factorization $\mathbf D=\mathbf R^{\mathsf T}\mathbf R$, with $\operatorname{rank}\mathbf D\le2K$, using user-level $2\times2$ coefficients.
3. At a regular fixed point, correcting the largest normalized gap modes minimizes the local spectral radius within a prescribed rank budget and PSD correction class.
4. Computable Hessian Lipschitz bounds for the exact log-quadratic pullback, yielding certified cubic MM and a small numerical prototype.

On six full-support, nearly orthogonal channels, baseline XMMSE requires 8-10 steps to reach the common KKT tolerance; the full-gap hybrid requires 4-7. These samples and millisecond timings do not establish general wall-clock acceleration. Dense horizontal bases and linear algebra remain prototype bottlenecks.

These are internal analytic derivations and finite numerical checks, without a claim of literature priority. Riemannian Newton methods, quotient optimization, and cubic regularization are established tools; the focus here is the XMMSE-specific gap and its computable certificate.[^1][^2][^3]

## 2. Problem, quotient, and notation

Consider

$$
f(\mathbf V)=\sum_{k=1}^K w_k\log\left(1+
\frac{|\mathbf h_k^{\mathsf H}\mathbf v_k|^2}
{\sigma^2+\sum_{j\ne k}|\mathbf h_k^{\mathsf H}\mathbf v_j|^2}\right),
\qquad \sum_k\|\mathbf v_k\|^2\le P.
\tag{1}
$$

Assume $w_k>0$ and $\sigma>0$. Mathematical beamformers are columns of $\mathbf V$; code stores them by row. The real vector $\mathbf v$ concatenates real and imaginary parts, has dimension $n=2KN_t$, and uses the real Frobenius inner product.

On the regular full-power region with every $\mathbf v_k\ne\mathbf0$, define

$$
\mathcal M=\{\mathbf v:\|\mathbf v\|^2=P,\ \mathbf v_k\ne\mathbf0\},
\qquad
\mathcal Q=\mathcal M/\mathbb T^K.
$$

$\mathbb T^K$ denotes independent user phases. Vertical directions are generated by $i\mathbf v_k$ in the corresponding beam block. The Euclidean horizontal space is

$$
\mathcal H_{\mathbf v}=
\left\{\boldsymbol{\xi}:
\Re\sum_k\mathbf v_k^{\mathsf H}\boldsymbol{\xi}_k=0,
\quad\Im(\mathbf v_k^{\mathsf H}\boldsymbol{\xi}_k)=0\ \forall k\right\}.
\tag{2}
$$

Let $\mathbf Z\in\mathbb R^{n\times d}$ be an orthonormal real basis, $d=2KN_t-K-1$. Horizontal displacements are $\mathbf Z\mathbf s$, $\mathbf s\in\mathbb R^d$. Latin matrices and vectors use $\mathbf A,\mathbf v$; Greek matrices and vectors use $\boldsymbol{\Lambda},\boldsymbol{\xi}$. Scalars such as $\mu,\sigma,\lambda_i$ are unbolded.

The envelope factorization and accelerator below use full support and nonzero desired signals. Their formulas must not be applied through a support change. For the baseline local-rate theorem, a separate smooth slice removes only the phases of nonzero beams and retains every inactive beam perturbation; see Section 5.4. Do not invert a singular phase basis or infer stability just by discarding inactive users.

## 3. Exact phase envelope

At reference $\underline{\mathbf V}$, write the XMMSE model as

$$
Q_{\mathrm X}(\mathbf V\mid\underline{\mathbf V})
=c_0+\sum_k\left[
-\mathbf v_k^{\mathsf H}\mathbf A_k\mathbf v_k
+2\Re(\mathbf B_k^{\mathsf H}\mathbf v_k)\right].
$$

Define

$$
\boxed{
\widehat Q_{\mathrm X}([\mathbf V]\mid[\underline{\mathbf V}])
=c_0+\sum_k\left[
-\mathbf v_k^{\mathsf H}\mathbf A_k\mathbf v_k
+2|\mathbf B_k^{\mathsf H}\mathbf v_k|\right].}
\tag{3}
$$

**Proposition 1.** Equation (3) is a global minorant of the objective, is well-defined on phase classes of both arguments, and has first-order contact whenever every desired signal at the reference is nonzero.

**Proof.** For every phase vector $\boldsymbol{\theta}$, $Q_{\mathrm X}(\{e^{i\theta_k}\mathbf v_k\}\mid\underline{\mathbf V})\le f(\mathbf V)$. Maximizing each phase replaces the linear term by its modulus. Changing reference phases rotates $\mathbf B_k$ and leaves $\mathbf A_k$ unchanged. Since $\mathbf B_k^{\mathsf H}\underline{\mathbf v}_k>0$, the maximizing phase is zero at the reference; the smooth envelope has value and gradient contact.

**Limitation.** Phase elimination alone cannot accelerate exact MM. Phase invariance of the feasible set gives

$$
\max_{\mathbf V\in\mathcal C}\widehat Q_{\mathrm X}(\mathbf V)
=\max_{\mathbf V\in\mathcal C}\max_{\boldsymbol{\theta}}
Q_{\mathrm X}(\{e^{i\theta_k}\mathbf v_k\})
=\max_{\mathbf V\in\mathcal C}Q_{\mathrm X}(\mathbf V).
\tag{4}
$$

Every envelope maximizer can be rotated into a maximizer of the original quadratic. The envelope identifies the appropriate curvature but is not a separate acceleration algorithm.

## 4. Exact quotient curvature at a general reference

### 4.1 Retraction and Lagrangian curvature

At a full-power point $\mathbf v$, use

$$
\mathcal R_{\mathbf v}(\mathbf s)
=\sqrt{\frac P{P+\|\mathbf s\|^2}}
(\mathbf v+\mathbf Z\mathbf s).
\tag{5}
$$

Equation (5) preserves full power for all finite arguments and defines a local quotient section near the origin. Set

$$
\mathcal F(\mathbf s)=f(\mathcal R_{\mathbf v}(\mathbf s)),
\quad\mathbf g_q=\nabla\mathcal F(\mathbf0),
\quad\mathbf H_q=-\nabla^2\mathcal F(\mathbf0).
$$

Use the complex half-gradient $df[\boldsymbol{\xi}]=2\Re\langle\mathbf g,\boldsymbol{\xi}\rangle$, retaining $\mathbf g$ for its real representation. With $\lambda=\langle\mathbf v,\mathbf g\rangle/P$,

$$
\mathbf g_q=2\mathbf Z^{\mathsf T}\mathbf g,
\qquad
\boxed{\mathbf H_q=2\lambda\mathbf I-2\mathbf Z^{\mathsf T}(\mathrm D\mathbf g)\mathbf Z.}
\tag{6}
$$

Here $\lambda$ is the current radial gradient coefficient; it equals the optimal multiplier only at a KKT point. Equation (6) includes the second derivative of the retraction. Simply compressing the Euclidean Hessian is insufficient.

### 4.2 Explicit envelope curvature

Let $\mathbf A=\operatorname{blkdiag}(\mathbf A_k)$ denote the corresponding real symmetric operator. Define

$$
\gamma_k=\Re(\mathbf B_k^{\mathsf H}\mathbf v_k)>0,
\qquad
\mathbf c_k^{\mathsf T}\mathbf s=
\Im[\mathbf B_k^{\mathsf H}(\mathbf Z\mathbf s)_k].
$$

The negative Hessian of the envelope pullback is

$$
\boxed{
\mathbf S_q
=2\mathbf Z^{\mathsf T}\mathbf A\mathbf Z+2\lambda\mathbf I
-2\sum_k\frac{\mathbf c_k\mathbf c_k^{\mathsf T}}{\gamma_k}.}
\tag{7}
$$

The second derivative of $2|\gamma_k+t z|$ at zero is $2(\Im z)^2/\gamma_k$. Adding the quadratic and retraction terms proves (7), including at nonstationary references.

At a regular fixed point, (7) equals the phase Schur complement of $\mathbf A+\mu\mathbf I$ from the preceding report, up to the factor two between real Hessians and complex half-gradients. That fixed-point identity cannot generally be applied away from stationarity.

## 5. The curvature gap has rank at most $2K$

### 5.1 User-level $2\times2$ gap matrix

Use the noise-normalized statistics

$$
p_k=\frac{|\mathbf h_k^{\mathsf H}\mathbf v_k|}{\sigma}>0,
\qquad
y_k=1+\sum_{j\ne k}\frac{|\mathbf h_k^{\mathsf H}\mathbf v_j|^2}{\sigma^2}.
$$

Suppress the user index temporarily. The phase-envelope user model is

$$
\widehat q(p',y')=-a(p')^2+2bp'-cy',
$$

Here $a=[\log(1+p^2/y)-p^2/(y+p^2)]/p^2$, $b=\log(1+p^2/y)/p$, and $c=p^2/[y(y+p^2)]$. The user gap Hessian with respect to $(p\prime,y\prime)$ is

$$
\boxed{
\mathbf T_k=
\begin{bmatrix}
2a_k+\dfrac{2(y_k-p_k^2)}{(y_k+p_k^2)^2}
&-\dfrac{2p_k}{(y_k+p_k^2)^2}\\[5pt]
-\dfrac{2p_k}{(y_k+p_k^2)^2}
&\dfrac1{y_k^2}-\dfrac1{(y_k+p_k^2)^2}
\end{bmatrix}\succeq\mathbf0.}
\tag{8}
$$

This matrix is PSD because the nonnegative gap has a zero minimum at the reference. Its principal minors provide an equivalent direct check; finite sampling is not needed for this conclusion.

For $\boldsymbol{\xi}=\mathbf Z\mathbf s$, define $\mathbf J_k\in\mathbb R^{2\times d}$ by

$$
\mathbf J_k\mathbf s=
\begin{bmatrix}
\sigma^{-1}\Re[e^{-i\phi_k}\mathbf h_k^{\mathsf H}\boldsymbol{\xi}_k]\\[2pt]
2\sigma^{-2}\Re\sum_{j\ne k}
(\mathbf h_k^{\mathsf H}\mathbf v_j)^*
\mathbf h_k^{\mathsf H}\boldsymbol{\xi}_j
\end{bmatrix},
\quad\phi_k=\arg(\mathbf h_k^{\mathsf H}\mathbf v_k).
\tag{9}
$$

### 5.2 Theorem 2: low-rank Gram factorization

At every regular reference described above,

$$
\boxed{
\mathbf D_q:=\mathbf S_q-\mathbf H_q
=\sum_k w_k\mathbf J_k^{\mathsf T}\mathbf T_k\mathbf J_k
=\mathbf R^{\mathsf T}\mathbf R,}
\tag{10}
$$

A valid factor is

$$
\mathbf R=\begin{bmatrix}
\sqrt{w_1}\mathbf T_1^{1/2}\mathbf J_1\\
\vdots\\
\sqrt{w_K}\mathbf T_K^{1/2}\mathbf J_K
\end{bmatrix}\in\mathbb R^{2K\times d}.
$$

Thus $\operatorname{rank}\mathbf D_q\le\min(2K,d)$.

**Proof.** The total gap is a weighted sum of user gaps, each with zero value and gradient at the reference. In the second-order chain rule, every second derivative of the statistics map is multiplied by a zero gap gradient. Only the Jacobian-Hessian-Jacobian terms remain. Taking PSD square roots gives the Gram factorization.

No general $d\times d$ gap matrix needs to be formed, factored, or inverted. The earlier report's certificate involving $\mathbf D_q^{-1}$ is usually unavailable because this gap is highly singular.

### 5.3 Implications for local XMMSE dynamics

Let $T_{\mathrm X}(\mathbf V)$ denote the **actual exact XMMSE update**: form its quadratic coefficients at $\mathbf V$, solve the power-constrained QCQP, and regard the output modulo independent user phases. It obeys

$$
(\mathbf A_{\mathrm X,k}(\mathbf V)+\mu^+(\mathbf V)\mathbf I)
(\mathbf v_k^+-\mathbf v_k)
=\mathbf g_k(\mathbf V)-\mu^+(\mathbf V)\mathbf v_k.
\tag{11a}
$$

At a fixed point, the right-hand side is zero. Differentiating (11a) cancels the derivatives of the surrogate coefficient multiplying the zero displacement. Differentiating the active power equality removes the normal direction; eliminating free output phases produces the Schur complement, which equals $\mathbf S_q$ in (7) at stationarity. Thus, at a regular fixed point with full support, positive multiplier, and $\mathbf H_q\succ\mathbf0$,

$$
\boxed{
\mathbf J_{\mathrm X,q}
=\mathbf I-\mathbf S_q^{-1}\mathbf H_q
=\mathbf S_q^{-1}\mathbf R^{\mathsf T}\mathbf R.}
\tag{11}
$$

This is the Jacobian of $T_{\mathrm X}$ itself. In fixed local quotient coordinates, $\mathbf e_{t+1}=\mathbf J_{\mathrm X,q}\mathbf e_t+O(\|\mathbf e_t\|^2)$. No extra linearized subproblem is being substituted into XMMSE. A zero-correction cubic method shares this first derivative under bounded regularization and an inactive radius, but its finite steps generally differ from XMMSE. Exact maximization of the phase envelope, by contrast, gives exactly the same update orbit by (4).

The quotient Jacobian has rank at most $2K$. At least $\max\{d-2K,0\}$ eigenvalues vanish; only at most $2K$ normalized gap modes govern the linear convergence bottleneck. Its spectral radius is the largest eigenvalue of $\mathbf R\mathbf S_q^{-1}\mathbf R^{\mathsf T}$. A value close to one means the minorant has nearly as much excess curvature as total effective curvature in a slow direction. The purpose of the correction is to remove those modes.

This does not imply finite termination: higher-order coupling can regenerate errors in zero-eigenvalue modes. Support changes, degenerate fixed points, and arbitrary inexact implementations are not covered.

### 5.4 Complete local-rate theorem and what replaces concavity

**Theorem 2A (both exact baseline maps).** Suppose a nonzero-rate KKT point is a constrained local maximum modulo its active phases and has no zero constrained-Hessian directions beyond those phase directions. Equivalently, require second-order stationarity and nonsingularity after phase removal. Then both exact WMMSE and XMMSE converge locally at least linearly from sufficiently close sphere points. Ambient WSR concavity is not assumed. On a smooth slice with orthonormal tangent basis $\mathbf Z$ and active-phase basis $\mathbf F$, set

$$
\begin{aligned}
\mathbf M_j&=\mathbf A_j+\mu_\star\mathbf I,\\
\mathbf H&=2\mathbf Z^{\mathsf T}(\mu_\star\mathbf I-\mathrm D\mathbf g)\mathbf Z,\\
\mathbf S_j&=2[\mathbf Z^{\mathsf T}\mathbf M_j\mathbf Z-
\mathbf Z^{\mathsf T}\mathbf M_j\mathbf F
(\mathbf F^{\mathsf T}\mathbf M_j\mathbf F)^{-1}
\mathbf F^{\mathsf T}\mathbf M_j\mathbf Z],\\
\rho_j&=1-\lambda_{\min}(\mathbf H,\mathbf S_j)<1,
\qquad j\in\{\mathrm W,\mathrm X\}.
\end{aligned}
\tag{11b}
$$

The proof has four steps: positive noise gives a positive multiplier at a nonzero-rate KKT point; the bordered quadratic KKT system is nonsingular; constrained second-order necessity plus nondegeneracy gives $\mathbf H\succ\mathbf0$; and minorization gives $\mathbf H\preceq\mathbf S_j$. Therefore $\mathbf I-\mathbf S_j^{-1}\mathbf H$ is similar to a symmetric matrix with eigenvalues in $[0,1)$. Derivative continuity then proves contraction in a neighborhood, not merely an endpoint spectral calculation. See the [complete proof, including active-user slices](../_raw/Quotient_Rates_and_MM_Proofs.md#1-local-convergence-without-ambient-concavity).

For every $q\in(\rho_j,1)$, errors contract at most by $q$ in the fixed $\mathbf S_j$ coordinate norm sufficiently close to the solution. Other equivalent norms give R-linear bounds. Particular trajectories need not attain the worst spectral factor. When $\rho_j=0$, higher-order convergence is possible. Positive definite constrained curvature follows from the stated hypotheses; it is not implied by KKT conditions, full channel rank, or Gaussian sampling.

If some beams vanish, keep their real and imaginary perturbations and remove only nonzero phase generators. This proves a local slice result without asserting that the quotient by all user phases is smooth there. The full-support envelope and its $2K$ factorization still require their own assumptions.

### 5.5 A concrete obstruction to unconditional linear convergence

Arbitrary KKT points may be unstable. With two identical scalar channels, equal weights and fixed total power, equal power allocation is a KKT point but a strict minimum along the allocation direction.

More strongly, even a WSR maximum may be degenerate. Set $K=N_t=2$, unit noise and weights, $b=(1+P)^{-1}$,

$$
\mathbf h_1=(1,0)^{\mathsf T},\quad
\mathbf h_2=(0,\sqrt b)^{\mathsf T},\quad
\mathbf V(z)=\operatorname{diag}(\sqrt{P-z^2},z).
$$

Then

$$
f(\mathbf V(z))=\log(1+P)+\log(1-b^2z^4),
\qquad
z^+=z-2bz^3+O(z^5)
\quad\text{for both WMMSE and XMMSE}.
\tag{11c}
$$

The optimum $z=0$ has positive multiplier but zero curvature in the emerging-user direction. For small positive initialization, $z_t\sim(4bt)^{-1/2}$, the objective gap is order $t^{-2}$, and the KKT residual is order $t^{-3/2}$. These are genuinely sublinear iterates. The [full derivation](../_raw/Quotient_Rates_and_MM_Proofs.md#2-why-a-theorem-for-arbitrary-kkt-points-is-false) explains invariance of the diagonal family and the expansion of the exact multiplier for each method. This deliberately tuned example does not establish a positive probability of degeneracy under Gaussian channels.

There is also a sharp nearby limit: reduce the second channel power gain to $\kappa<b$. The single-user optimum becomes nondegenerate, yet both local factors equal $\kappa/b$, approaching one as $\kappa\uparrow b$. Therefore neither a uniform contraction margin nor a universal strict WMMSE/XMMSE gap holds across optima that include inactive users. Full-support strictness remains a separate question.

### 5.6 Quantifying the WMMSE-to-XMMSE rate improvement

At a common full-support regular maximum define $s_k=p_k^2/y_k$ and $\eta_k=[1-\log(1+s_k)/s_k]/y_k>0$. The exact envelope difference is

$$
\widehat Q_{\mathrm X}-\widehat Q_{\mathrm W}
=\sum_k w_k\eta_k(p'_k-p_k)^2.
$$

Consequently, if $\mathbf j_k^{\mathsf T}$ is the first row of (9),

$$
\boldsymbol\Delta:=\mathbf S_{\mathrm W}-\mathbf S_{\mathrm X}
=2\sum_k w_k\eta_k\mathbf j_k\mathbf j_k^{\mathsf T}\succeq\mathbf0,
\qquad\operatorname{rank}\boldsymbol\Delta\le K.
\tag{11d}
$$

Let $\alpha_{\mathrm W}=\lambda_{\min}(\mathbf H,\mathbf S_{\mathrm W})$ and $\mathbf N=\mathbf H-\alpha_{\mathrm W}\mathbf S_{\mathrm W}\succeq\mathbf0$. Then

$$
\boxed{\rho_{\mathrm W}-\rho_{\mathrm X}
=\lambda_{\min}\left(\mathbf S_{\mathrm X}^{-1/2}
[\mathbf N+\alpha_{\mathrm W}\boldsymbol\Delta]
\mathbf S_{\mathrm X}^{-1/2}\right)\ge0.}
\tag{11e}
$$

Strict improvement holds exactly when $\ker\mathbf N\cap\ker\boldsymbol\Delta=\{\mathbf0\}$: every vector in the slowest WMMSE eigenspace must be affected by the curvature reduction. This can hold even though $\boldsymbol\Delta$ is low rank. A computable lower bound is $\lambda_{\min}(\mathbf N+\alpha_{\mathrm W}\boldsymbol\Delta)/\lambda_{\max}(\mathbf S_{\mathrm X})$. See the [identity and strictness proof](../_raw/Quotient_Rates_and_MM_Proofs.md#3-exact-miso-rate-gap-certificate-at-a-common-regular-maximum).

For the checked orthogonal three-user optimum, $\rho_{\mathrm W}=0.5965934$, $\rho_{\mathrm X}=0.2114964$, the exact gap is $0.3850969$, and this lower bound is $0.1539470$. No universal positive gap follows: the criterion may fail, curvatures can become arbitrarily small, and methods may approach different solutions. Full strict H1 remains unproved.

## 6. Optimal local correction under a rank budget

### 6.1 A $2K\times2K$ eigenproblem

Where $\mathbf H_q\succ\mathbf0$, define

$$
\boxed{\mathbf C_q=\mathbf R\mathbf S_q^{-1}\mathbf R^{\mathsf T}.}
\tag{12}
$$

Its nonzero eigenvalues equal those of $\mathbf S_q^{-1/2}\mathbf D_q\mathbf S_q^{-1/2}$. Write

$$
\delta_1\ge\delta_2\ge\cdots\ge\delta_r>0,
\qquad r=\operatorname{rank}\mathbf D_q\le2K,
\quad\delta_1<1.
$$

The $\delta_i$ are scalar eigenvalues. Let $\mathbf U_m$ contain orthonormal eigenvectors for the largest $m$ eigenvalues of $\mathbf C_q$, and set

$$
\boxed{
\mathbf E_m=\mathbf R^{\mathsf T}\mathbf U_m\mathbf U_m^{\mathsf T}\mathbf R,
\qquad
\mathbf B_m=\mathbf S_q-\mathbf E_m.}
\tag{13}
$$

Since $\mathbf U_m\mathbf U_m^{\mathsf T}\preceq\mathbf I$,

$$
\mathbf0\preceq\mathbf E_m\preceq\mathbf D_q,
\qquad\mathbf H_q\preceq\mathbf B_m\preceq\mathbf S_q.
$$

The projection is placed between Gram factors. This supplies the PSD certificate, unlike the generally false assertion $\mathbf P\mathbf D_q\mathbf P\preceq\mathbf D_q$.

### 6.2 Theorem 3: optimal rank budget

At the same regular fixed point, omit terms of order three and higher and consider all corrections satisfying

$$
\mathbf B=\mathbf S_q-\mathbf E,
\quad \mathbf0\preceq\mathbf E\preceq\mathbf D_q,
\quad\operatorname{rank}\mathbf E\le m.
$$

The smallest attainable linearized spectral radius is

$$
\boxed{
\min_{\mathbf E}\rho(\mathbf I-\mathbf B^{-1}\mathbf H_q)
=\delta_{m+1},}
\tag{14}
$$

Use $\delta_{m+1}=0$ for $m\ge r$. Construction (13) attains this value.

See the [rank-budget optimality proof](proofs/Quotient_Local_Curvature_MM_Proofs.md#proof-1) for the detailed proof and retained equation numbering.


Correct the largest normalized curvature gaps, rather than the largest Euclidean curvatures or strongest users. Optimality holds locally within this PSD correction class, not over all nonconvex algorithms.

At a tied truncation eigenvalue, the selected subspace need not be unique. Differentiable-map arguments require a separated selected cluster or correction of the entire tied cluster.

### 6.3 High-accuracy local behavior

Full correction gives $\mathbf B_r=\mathbf H_q$. A bounded cubic regularizer contributes zero to the first-order update Jacobian at the fixed point. Local quadratic convergence follows under a Lipschitz Hessian, uniform positive definiteness on the quotient, sufficiently accurate subproblem solves, and eventual inactivity of the radius constraint.

Partial correction generally remains linearly convergent, with optimal factor $\delta_{m+1}$. Full correction uses at most $2K$ directions, rather than $d$.
```

返回结果: 第 78/119 段失败；已保留 77 段。原因: 流式模型输出未通过结果校验: ['protected_content_order']

## 长文本与进度

- [x] 分别翻译 16,001、17,001 单段和 32,001 字符样例，检查段落顺序、首尾内容和编号，无漏段、重复段或拼接残留。
- [x] 使用个人实际长文复测，包括中英混合、公式、URL 和代码块；确认译文质量可接受。
- [x] 界面显示已完成段数、原文处理百分比及估算实时速度；每段通过校验后即可看到译文。
- [x] 重试/细分时进度不倒退，最终成功时为 100%；总段数可能因细分增加。
- [x] 翻译中点“取消翻译”，停止继续提交分段，保留已完成译文，明确标记未完成；可以再次开始翻译。
- [x] 翻译期间不能交换内容、修改语言或关闭模型，但可查看设置和历史。
- [x] 默认上限 100,000 字符，超过上限有提示；后端自定义 `max_input_chars` 会反映在界面中。

1. 长文本出现 bug 无法完成第一项测试 (见 example 1)
2. 无法重试翻译，每次取消翻译再开始翻译进度会重新开始
3. 无法继续提交分段，会重新开始

## 历史与导航

- [x] 完整翻译后新增一条记录；取消/失败不会生成完整历史。
- [x] 重启后历史仍在；能展开完整内容、恢复到工作区、单条删除及确认后清空。
- [x] 超过 30 条时仅保留最新 30 条，不出现部分写入的记录。
- [x] 切换翻译、历史、模型、设置不丢失当前文本；关闭模型后仍可查看历史和设置。
- [x] 恢复历史不会自动启动推理，也不会在翻译中覆盖正在处理的内容。

## 毛玻璃与交互

- [x] 浅色/深色主题的侧栏、阅读面板和设置风格统一，正文对比度清晰。
- [x] 图标导航有悬停说明和键盘焦点，设置入口位于左侧。
- [x] 语言选择支持中英文搜索、方向键选择、Enter 确认、Esc 关闭；选择后正确返回工作区。
- [x] 空文本可交换语言；已有译文时交换语言及两侧文本；动画不过度干扰阅读。
- [x] 启用/关闭模型显示对应动画，结束时间跟随后端实际结果；重复点击不会启动多个请求。
- [x] 启停失败时能看到错误信息并重试；关闭成功后模型显存释放。
- [x] 900×640 最小窗口和较大窗口下，左右/上下布局均可操作。
- [x] 开启系统减少动态效果后，脉冲和过渡动画停止。

1. 设置中无法开启系统减少动态效果选项

交互还需要改善的地方有：
1. 历史记录和设置界面需要自适应当前页面的大小
2. 设置界面要求重新打造 UI 交互，开关换成胶囊形状，切换深色浅色和左右上下也做成大的圆角矩形胶囊形式，并放入图形化的太阳月亮，左右上下排版切换的图标

## 自动验证记录

- Python：43 项测试通过（包含分段无损重组、单段长文、截断细分、取消清理、请求互斥、公式顺序和输出校验）。
- 前端：5 组测试通过（历史 30 条事务淘汰；公式定界符；SSE 完成/错误/断流；离线 MathJax 字形；导航、语言搜索、取消和状态保留）。
- 版本同步、TypeScript、Vite 构建、Rust 格式检查、`cargo check`、`cargo test` 均通过。
- 已运行 `npm run build:installer`；生成的安装包、运行时资源及测试产物不提交。
- 打包后的 gateway 冒烟验证通过：健康检查、100,000 输入上限、长文分段规划以及未安装模型的明确错误。
- 本地安装包 SHA-256：`2dce4efe4e93e71a7e43d9e7cdc892cba7840d2f9b7134e9bac2e82810e9d251`。
- 前端测试使用 jsdom，无桌面自动操作；语言对话框原生顶层、焦点表现及最终视觉效果仍须人工验收。

## 实机性能记录

2026-09-16，本机 RTX 5070（12 GB），Hy-MT2-7B Q6_K，llama.cpp b10545，8,192 上下文。预热后在同一自建测试模型进程上顺序执行基线和当前实现；这是单次样例数据，不是统计基准。

| 样例 | 基线首个可见译文 | 当前首段可见 | 基线总耗时 | 当前总耗时 | 当前自动重试 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 426 字符 | 0.94 s | 0.88 s | 0.94 s | 0.88 s | 0 |
| 3,059 字符、7 段 | 7.10 s | 0.99 s | 7.10 s | 7.06 s | 0 |
| 16,001 字符 | 超出旧上限 | 0.96 s | 不支持 | 36.68 s | 0 |
| 32,001 字符 | 未运行 | 0.98 s | 不支持 | 74.19 s | 0 |
| 17,001 字符重复句单段 | 未运行 | 0.93 s | 不支持 | 1.75 s | 0 |
| 825 字符公式混合样例 | 未运行 | 0.52 s | 未运行 | 1.54 s | 0 |

主要收益是更早看到译文、长文可完成及局部重试；这些数据没有证明模型本身的 tokens/s 显著提升。重复段落仅在同一次请求中复用已校验结果；同一文档重复出现的段落仍会完整输出。重复单段样例的 1.75 秒主要来自请求内缓存，不可类推为普通长文的性能。

数据及译文在 `artifacts/validation/benchmark.json`、`benchmark-extended.json`、`benchmark-single-paragraph.json` 和同目录文本文件中（单段最终结果以最后一份 JSON 为准）。模型语义质量仍需人工检查，不能由格式校验保证绝对正确。

取消会立即停止界面请求，后端在下一次可写进度/模型输出时关闭上游连接；模型预填充阶段可能有短暂等待。失败段会自动重试/细分，最终失败后保留已完成译文；本版不提供跨应用重启的任务续传。

## 用户验收反馈

- 验收日期：
- 通过项目：
- 未通过项目及复现步骤：
- 截图/录屏（可选）：
- 是否同意推送并创建面向 master 的 PR：待用户确认。

验收确认前不推送、不创建或合并 GitHub PR。

## 第二轮修复与复验（2026-09-16）

本节记录对上述用户反馈的修改。原有勾选、问题描述和 example 1 全文均保留；以下项目仍由用户复验。

### 本轮修改

- 修正 `protected_content_order` 误判：行内公式允许跟随译文语序调整；公式内容、出现次数及展示公式/代码块顺序仍进行检查。
- 增加内存任务断点。取消或失败后点击“继续翻译”，只处理剩余分段；续传时以服务端已完成内容校准界面，避免断流造成重复拼接。“重新翻译”明确从头开始。
- 原文、语言或模型改变后不沿用旧断点。网关最多保留最近 8 个任务，闲置 1 小时后过期，退出应用后不保留未完成任务。
- 设置增加“减少动态效果”胶囊开关，立即生效并保存。系统减少动态效果设置仍自动生效，此开关不会修改 Windows 系统设置。
- 设置与历史页面使用可滚动的自适应全宽布局；主题和排版采用带太阳/月亮、左右/上下图标的胶囊选项，布尔设置采用胶囊开关。

### 复验清单

- [x] 用 example 1 再次翻译，跨过原来的第 78 段并完成 119/119 段；人工核对公式对应关系和译文语义。
- [x] 翻译若干段后取消，确认译文和进度保留；点击“继续翻译”，不从第 1 段重新开始，无重复段落。
- [x] 若某段失败，修复运行环境后点击“继续翻译”，从未完成段继续；失败任务不写入完整历史。
- [x] 点“重新翻译”从头开始；修改原文或语言后显示“开始翻译”，不会拼接旧任务内容。
- [x] 续传完成只保存一条完整历史记录，首尾完整、进度为 100%。
- [x] 设置开启“减少动态效果”后过渡和脉冲停止，重启仍保留；关闭后跟随系统偏好。
- [x] 最小窗口、最大化窗口下检查设置与历史自适应宽高，内容可以滚动，无按钮遮挡。
- [x] 浅色/深色与左右/上下胶囊选项图标清晰、选中状态明确，键盘可操作；各胶囊开关功能正确。

### 本轮验证

- Python 49 项、前端 6 组、Rust 2 项测试通过；版本同步、TypeScript、Vite 构建、Rust 格式和检查通过。
- 使用本机 RTX 5070、Hy-MT2-7B Q6_K、llama.cpp b10545 实测 example 1：22,259 字符、119 段，第 77 段后取消，从第 78 段继续至 119/119，质量检查无错误；单次总耗时 52.31 秒。
- 实测报告与译文：`artifacts/validation/round2-report.json`、`artifacts/validation/round2-translation.md`。速度是此样例单次数据，语义质量仍待人工验收。
- 全程未使用桌面自动操作；界面最终视觉效果待人工验收。继续仅保留本地提交，不推送、不创建 PR。
- 本轮重新执行 `npm run build:installer`；新安装包 SHA-256：`e4c8147e9629a04ea490c41b01a11d83ae948c2c10f25244b16ce875f5c3f157`（替代上方首轮包）。
- 新打包网关冒烟验证通过：健康检查、任务 ID、取消接口、完成任务重放，无额外推理请求。

## 第三轮复验：0.2.0-beta.2

本轮继续在 `codex/lat-ui-longtext-stability` 本地分支工作，保留此前反馈和勾选。新版安装包单独放在 `artifacts/v0.2.0-beta.2/`；安装前退出旧版 LAT，避免仍使用旧网关。未推送 GitHub。

### 改动说明

- 通用按钮、危险按钮、胶囊开关、图标选项组和设置选择框集中到 `src/components/Controls.tsx` 与 `controls.css`。开关使用 48×28 轨道和 20×20 圆点，布局居中，避免原生 checkbox 伪元素偏移。
- Hy-MT2 使用简短的指令与正文分隔结构；按 [官方任务示例](https://huggingface.co/tencent/Hy-MT2-1.8B/blob/main/README.md)调整，失败段以更短指令重试。新增中文提示词泄漏检测；可疑结果在显示和写入历史之前拦截。原文自带的指令语句不应被误当作泄漏。
- 保护 Markdown 相对链接目标，避免文档文件名被翻译；保留公式保护和断点续传机制。
- 模型运行时的模型页显示显存、利用率、功率和温度四类趋势图。支持多张 NVIDIA 显卡，指标是整卡数据，包含其他程序占用；不将显卡总占用标成 LAT 独占。缺失值显示“暂不可用”，而非伪造为 0。
- 监测只在模型看板可见时请求，页面隐藏/离开时停止。后端采样有超时及缓存，不占用翻译任务锁。刷新间隔可选 1/2/5 秒，趋势范围可选 1/2/5 分钟；趋势仅保留本次看板会话。
- 历史默认仍保留 30 条，可选 10/30/50/100/200 条；降低上限前确认，之后立即淘汰最早记录。可关闭新记录保存，已有记录继续保留。
- 历史页只保留顶部“翻译历史”标题，右上角替换为“清空历史”，与关闭模型共用危险按钮样式。展开历史时原文和译文等高、独立滚动；小窗口上下排列仍等高。

### 本轮待验收

- [x] 在浅色/深色主题及 Windows 100%/125%/150% 缩放下检查所有胶囊开关：圆点垂直居中，开关两端留白一致，键盘空格可切换。
- [x] 使用 `hy-mt2-1.8b:q8_0` 翻译 `tests/fixtures/prompt-leak-source.md`，无“仅返回翻译后的文本”等规则泄漏，无 `[源文本]`，标题、加粗及链接正常。
- [x] 1.8B 和 7B 分别翻译原来的 example 1，确认长文完成、公式完整；人工检查语义质量。
- [x] 模型启用后进入“模型”：显示四类实时图表；翻译中查看时数值和趋势会更新，取消/完成后仍显示真实负载。
- [x] 检查显卡名称、整卡显存/功率/温度，结合本机 NVIDIA 工具确认量级一致；不支持的项显示不可用。
- [x] 更改刷新间隔与趋势范围，切换页面及隐藏窗口再回来，监测可恢复；不会持续叠加请求。
- [x] 历史上限改为 50/100 后可以超过 30 条；调低上限时取消确认不会删除，确认后只保留最新指定数量；重启后设置仍保留。
- [x] 关闭“保存翻译历史”后完成新翻译不新增记录，已有记录仍可查看；重新打开后恢复保存。
- [x] 历史页只显示一个“翻译历史”标题，右上角是“清空历史”，鼠标悬停变红，取消清空确认不会丢记录。
- [x] 翻译页的“关闭模型”在右上角，翻译中禁用；历史页不再重复显示关闭模型按钮。
- [x] 展开长短差异较大的历史，原文/译文区域高度一致、分别滚动；最大化与最小窗口均可阅读和恢复记录。

### 自动验证

- Python 56 项、前端 8 组及 Rust 2 项测试通过；版本同步、TypeScript、Vite 构建、Rust 格式和检查通过。
- 前端测试覆盖设置持久化、动态容量淘汰、看板曲线/缺失值/断线和卸载停止轮询、历史顶部操作与双栏结构。
- 实测报告：`artifacts/validation/round3-report.json`；两种模型的短文、公式与完整长文译文在同目录 `round3-*.md`。真实模型输出的语义质量与桌面视觉仍由用户验收。
- 最终实机结果（RTX 5070）：1.8B Q8_0 对本轮短文用时 0.57 秒，7B Q6_K 用时 1.47 秒，均无泄漏/自动重试；公式样例均通过。22,259 字符长文均完成 119/119 段，1.8B 用时 22.70 秒（1 次安全重试），7B 用时 57.30 秒（0 次重试）。这是单次测量，不代表所有文本的性能。
- 新版安装包已构建；SHA-256：`f105673bdb111f130fb6938ba4cfafe2b502bff83dab1bf9538fbc7fba499666`，校验文件位于同目录 `SHA256SUMS.txt`。
- 打包后的 beta.2 网关通过健康检查及显卡实时采样冒烟验证；本机 RTX 5070 显存/利用率/功率/温度均成功读取，采样时间可更新。原始记录在 `artifacts/validation/round3-telemetry.json`，验证进程已正常关闭。

## 第四轮复验：0.2.0-beta.3（2026-09-19）

用户已确认 beta2 全项通过。本轮继续仅做本地提交，不推送或创建 PR。安装 beta3 前请退出旧版 LAT。

### 改动

- 历史记录收起状态固定元信息和三行摘要区域，避免中英文换行差异导致卡片高度不同；完整内容在展开后查看，保留等高双栏和独立滚动。
- 显卡刷新间隔增加 0.5 秒，设置持久化；图表横轴左端改为正数“60 秒 / 120 秒 / 300 秒”。
- 本地网关启动即开始后台采样，模型尚未启用、页面切换或窗口隐藏期间持续记录。最近 5 分钟最多 601 个采样点保存在内存中，看板按选择的范围显示；退出应用后不持久化。
- 移除看板的 GPU MONITOR 与说明行；刷新间隔、采样时间和“最近 x 分钟”放在显卡型号右侧，小窗口自动换行。
- 页面滚动区预留稳定的滚动条槽位及内容间距，文本、历史正文与语言列表也预留槽位，避免有无滚动条造成横向布局跳变。

### 待复验

- [ ] 同时保存短中文译英、长英文译中记录，收起状态卡片高度一致，摘要最多三行；展开后内容完整且两侧等高。
- [ ] 选择 0.5 秒刷新，重启后仍保留；显卡型号右侧显示刷新间隔、时间及“最近 x 分钟”。
- [ ] 图表左下角显示“60 秒 / 120 秒 / 300 秒”，没有负号；原来的 GPU MONITOR 及整卡说明行已移除。
- [ ] 启动后停留在模型选择页或翻译页一段时间，再进入看板，能看到此前积累的曲线。
- [ ] 从看板切到设置/历史，或隐藏窗口，稍后返回曲线仍连续；关闭/重新启用模型也不清空趋势。
- [ ] 运行超过 5 分钟后，趋势只保留所选范围内的数据；更换范围可查看本次运行已积累的最近 5 分钟。
- [ ] 在设置、历史、模型页面分别触发/消除纵向滚动条，页面内容水平位置不跳动，滚动条与内容有间距；长历史和翻译正文也不紧贴滚动条。

### 自动验证

- Python 58 项、前端 8 组测试通过，包含后台独立采集、0.5 秒设置恢复、601 点时间淘汰，以及看板读取进入页面前的历史数据。
- 未使用桌面自动操作；卡片视觉等高、滚动条间距和不同缩放比例仍由用户复验。
- 版本同步、TypeScript、Vite 构建、Rust 格式检查、`cargo check` 和 2 项 Rust 测试通过；已执行 `npm run build:installer`。
- 打包网关实机测试：首次获取看板数据前已后台记录 7 点，关闭模型后保留旧点并增至 9 点；0.5 秒档位测得最近采样间隔中位数 0.512 秒。报告：`artifacts/validation/beta3-telemetry.json`。
- beta3 安装包 SHA-256：`8fbec08f06ede7db4e6fa6da5e735547d089fb0e344330c8ba195c610be0ed73`，同目录提供 `SHA256SUMS.txt`。
