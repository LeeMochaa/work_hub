export default function LogoDisplay({ style = {} }) {
  const logoUrl = "/assets/logo";

  return (
    <FlexBox
      direction={FlexBoxDirection.Column}
      justifyContent={FlexBoxJustifyContent.Center}
      alignItems={FlexBoxAlignItems.Center}
      style={{ padding: "1rem", ...style }}
    >
      <img
        src={logoUrl}
        alt="Company Logo"
        style={{ maxWidth: "200px", maxHeight: "100px", objectFit: "contain", borderRadius: "8px" }}
        onError={(e) => {
          // 로고 없을 때 fallback UI로 전환하려면 state 처리 추천
          e.currentTarget.style.display = "none";
        }}
      />
    </FlexBox>
  );
}